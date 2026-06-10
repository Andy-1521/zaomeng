"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image, { type ImageLoaderProps, type ImageProps } from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import Sidebar from "@/components/Sidebar";
import PointsIconLabel from "@/components/PointsIconLabel";
import { useUser } from "@/contexts/UserContext";
import { showToast } from "@/lib/toast";
import {
  toUserFacingErrorFromUnknown,
  toUserFacingErrorMessage,
} from "@/lib/userFacingError";

type MarketTab = "market" | "purchased" | "mine" | "pending";

type MarketLayer = {
  id: string;
  name: string;
  visible: boolean;
  width: number;
  height: number;
  previewUrl?: string;
};

type MarketItem = {
  id: string;
  sellerId: string;
  sellerName?: string | null;
  sourceOrderNumber?: string | null;
  sourceImageUrl: string;
  previewImageUrl: string;
  thumbnailUrl?: string | null;
  title: string;
  description?: string | null;
  category: string;
  tags?: string[];
  pricePoints: number;
  status: "pending" | "approved" | "rejected" | "delisted";
  psdUrl?: string | null;
  psdLayerCount: number;
  psdLayers?: MarketLayer[];
  rejectionReason?: string | null;
  purchased?: boolean;
  orderNumber?: string | null;
  purchasedAt?: string | null;
  createdAt: string;
  similarityScore?: number;
};

type ApiResponse<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

type MarketStats = {
  pendingCount: number;
};

type HeroMarketImage = {
  id: string;
  title: string;
  url: string;
};

type HeroMarketTile = {
  id: string;
  title: string;
  url?: string;
  toneIndex?: number;
};

type DirectMarketListingDraft = {
  imageFile: File | null;
  imagePreviewUrl: string;
  psdFile: File | null;
  title: string;
  description: string;
  category: string;
  tags: string;
  pricePoints: number;
};

const MARKET_HERO_COLUMN_COUNT = 8;
const MARKET_HERO_ROWS_PER_COLUMN = 8;
const MARKET_HERO_IMAGE_LIMIT = 24;
const PUBLIC_MARKET_PREVIEW_LIMIT = 36;
const DIRECT_LISTING_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DIRECT_LISTING_MAX_PSD_BYTES = 120 * 1024 * 1024;

const DEFAULT_DIRECT_LISTING_DRAFT: DirectMarketListingDraft = {
  imageFile: null,
  imagePreviewUrl: "",
  psdFile: null,
  title: "",
  description:
    "适合手机壳铺货、商品展示和二次编辑使用。购买后可用于商品铺货，不可二次转售素材文件。",
  category: "手机壳图案",
  tags: "手机壳 彩绘 铺货",
  pricePoints: 50,
};

const MARKET_HERO_FALLBACK_IMAGES: HeroMarketImage[] = Array.from(
  { length: 18 },
  (_, index) => {
    const fileIndex = String(index + 1).padStart(2, "0");
    return {
      id: `fallback-market-hero-${fileIndex}`,
      title: `图市固定背景素材 ${index + 1}`,
      url: `/assets/market-hero/dev-market-${fileIndex}.webp`,
    };
  },
);

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function SafeImage({ alt, ...props }: Omit<ImageProps, "loader">) {
  return (
    <Image {...props} alt={alt} loader={passthroughImageLoader} unoptimized />
  );
}

async function parseJsonApiResponse<T>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    throw new Error(fallbackMessage);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

function getDisplayImageUrl(url?: string | null) {
  if (!url) return "";
  if (url.startsWith("/")) return url;
  return url;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getStableMarketImageRatio(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 997;
  }
  return [1.18, 1.28, 1.38, 1.5][hash % 4];
}

function getFileTitle(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .slice(0, 60);
}

function MarketPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const marketSectionRef = useRef<HTMLElement | null>(null);
  const browseSectionRef = useRef<HTMLDivElement | null>(null);
  const marketBrowseLockedRef = useRef(false);
  const marketReturningTopRef = useRef(false);
  const imageSearchInputRef = useRef<HTMLInputElement | null>(null);
  const { user, isLoading, setPoints, refreshUser } = useUser();
  const [activeTab, setActiveTab] = useState<MarketTab>("market");
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<MarketItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<MarketItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [psdPreviewingItemId, setPsdPreviewingItemId] = useState("");
  const [psdPreviewErrorByItemId, setPsdPreviewErrorByItemId] = useState<
    Record<string, string>
  >({});
  const [selectedLayerPreviewId, setSelectedLayerPreviewId] =
    useState("source");
  const [purchaseCompletedItemId, setPurchaseCompletedItemId] = useState("");
  const [marketThumbnailSize, setMarketThumbnailSize] = useState(180);
  const [marketColumnCount, setMarketColumnCount] = useState(4);
  const [imageSearchActive, setImageSearchActive] = useState(false);
  const [imageSearchLoading, setImageSearchLoading] = useState(false);
  const [imageSearchPreviewUrl, setImageSearchPreviewUrl] = useState("");
  const [imageSearchFileName, setImageSearchFileName] = useState("");
  const [isImageSearchDragging, setIsImageSearchDragging] = useState(false);
  const [directListingDraft, setDirectListingDraft] =
    useState<DirectMarketListingDraft | null>(null);
  const [isSubmittingDirectListing, setIsSubmittingDirectListing] =
    useState(false);
  const [marketBrowseLocked, setMarketBrowseLocked] = useState(false);
  const [marketToolbarReveal, setMarketToolbarReveal] = useState(0);
  const [showMarketBackToTop, setShowMarketBackToTop] = useState(false);
  const [marketImageRatios, setMarketImageRatios] = useState<
    Record<string, number>
  >({});

  const marketThumbnailGap =
    marketThumbnailSize >= 300 ? 24 : marketThumbnailSize >= 240 ? 20 : 16;

  const tabs = useMemo(() => {
    const base: Array<{ key: MarketTab; label: string; count?: number }> = [
      { key: "market", label: "市场" },
    ];

    if (user?.id) {
      base.push(
        { key: "purchased", label: "已购" },
        { key: "mine", label: "我的上架" },
      );
    }

    if (user?.isAdmin) {
      base.push({ key: "pending", label: "待审核", count: pendingCount });
    }

    return base;
  }, [pendingCount, user?.id, user?.isAdmin]);

  const marketToolbarPinned = activeTab !== "market" || marketBrowseLocked;
  const publicMarketLocked = !user?.id && activeTab === "market";
  const visibleItems = useMemo(
    () =>
      publicMarketLocked ? items.slice(0, PUBLIC_MARKET_PREVIEW_LIMIT) : items,
    [items, publicMarketLocked],
  );
  const hasMorePublicItems =
    publicMarketLocked && items.length > visibleItems.length;

  const marketMasonryColumns = useMemo(() => {
    const displayColumnCount = Math.max(
      1,
      Math.min(marketColumnCount, Math.max(visibleItems.length, 1)),
    );
    const columns = Array.from(
      { length: displayColumnCount },
      () => [] as MarketItem[],
    );
    visibleItems.forEach((item, index) => {
      columns[index % displayColumnCount].push(item);
    });
    return columns;
  }, [visibleItems, marketColumnCount]);

  const heroImageColumns = useMemo(() => {
    const displayImages = MARKET_HERO_FALLBACK_IMAGES.slice(
      0,
      MARKET_HERO_IMAGE_LIMIT,
    );

    return Array.from(
      { length: MARKET_HERO_COLUMN_COUNT },
      (_, columnIndex) => {
        const columnImages = displayImages.filter(
          (_, imageIndex) =>
            imageIndex % MARKET_HERO_COLUMN_COUNT === columnIndex,
        );
        const filledColumn =
          columnImages.length > 0
            ? columnImages
            : [displayImages[columnIndex % displayImages.length]].filter(
                Boolean,
              );

        return Array.from(
          { length: MARKET_HERO_ROWS_PER_COLUMN },
          (_, rowIndex): HeroMarketTile => {
            const image =
              filledColumn[rowIndex % filledColumn.length] ||
              displayImages[(columnIndex + rowIndex) % displayImages.length];
            if (image) {
              return {
                ...image,
                id: `${image.id}-hero-repeat-${columnIndex}-${rowIndex}`,
              };
            }

            return {
              id: `hero-soft-tile-${columnIndex}-${rowIndex}`,
              title: "图市氛围占位",
              toneIndex: (columnIndex + rowIndex) % 4,
            };
          },
        );
      },
    );
  }, []);

  useEffect(() => {
    if (isLoading || !user?.id) return;
    void refreshUser();
  }, [isLoading, refreshUser, user?.id]);

  const requireLogin = useCallback(
    (next = "/market") => {
      showToast("登录后可继续使用完整图市功能", "info");
      router.push(`/login?next=${encodeURIComponent(next)}`);
    },
    [router],
  );

  useEffect(() => {
    if (!user?.isAdmin) return;
    if (searchParams.get("tab") === "pending") {
      setActiveTab("pending");
    }
  }, [searchParams, user?.isAdmin]);

  useEffect(() => {
    if (!user?.id && activeTab !== "market") {
      setActiveTab("market");
    }
  }, [activeTab, user?.id]);

  const loadMarketStats = useCallback(async () => {
    if (!user?.isAdmin) {
      setPendingCount(0);
      return;
    }

    try {
      const response = await fetch("/api/market/stats", {
        credentials: "include",
      });
      const data = await parseJsonApiResponse<ApiResponse<MarketStats>>(
        response,
        "加载图市统计失败",
      );
      if (response.ok && data.success) {
        setPendingCount(Number(data.data?.pendingCount || 0));
      }
    } catch {
      setPendingCount(0);
    }
  }, [user?.isAdmin]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const mode = activeTab === "market" ? "approved" : activeTab;
      const params = new URLSearchParams({ mode });
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const response = await fetch(
        `/api/market/listings?${params.toString()}`,
        { credentials: "include" },
      );
      const data = await parseJsonApiResponse<ApiResponse<MarketItem[]>>(
        response,
        "加载图市失败",
      );
      if (!response.ok || !data.success || !Array.isArray(data.data)) {
        throw new Error(toUserFacingErrorMessage(data.message, "加载图市失败"));
      }
      setItems(data.data);
      if (activeTab === "pending") {
        setPendingCount(data.data.length);
      }
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, "加载图市失败"), "error");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, keyword]);

  const resetImageSearchState = useCallback(() => {
    setImageSearchPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    setImageSearchFileName("");
    setImageSearchActive(false);
    setImageSearchLoading(false);
    if (imageSearchInputRef.current) {
      imageSearchInputRef.current.value = "";
    }
  }, []);

  const clearImageSearch = useCallback(() => {
    resetImageSearchState();
    void loadItems();
  }, [loadItems, resetImageSearchState]);

  const runKeywordSearch = useCallback(() => {
    resetImageSearchState();
    void loadItems();
  }, [loadItems, resetImageSearchState]);

  const lockMarketBrowse = useCallback(() => {
    if (marketReturningTopRef.current) return;
    if (marketBrowseLockedRef.current) return;
    marketBrowseLockedRef.current = true;
    setMarketBrowseLocked(true);
  }, []);

  const scrollToBrowseMarket = useCallback(() => {
    const browseSection = browseSectionRef.current;
    if (!browseSection) return;
    const targetTop =
      browseSection.getBoundingClientRect().top + window.scrollY - 92;
    window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    window.setTimeout(lockMarketBrowse, 720);
  }, [lockMarketBrowse]);

  const scrollToMarketTop = useCallback(() => {
    marketReturningTopRef.current = true;
    marketBrowseLockedRef.current = false;
    setMarketBrowseLocked(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(() => {
      marketReturningTopRef.current = false;
      setShowMarketBackToTop(
        window.scrollY > 420 || marketBrowseLockedRef.current,
      );
    }, 1000);
  }, []);

  const openMarketListingEntry = useCallback(() => {
    if (!user?.id) {
      requireLogin("/market");
      return;
    }

    resetImageSearchState();
    setDirectListingDraft({ ...DEFAULT_DIRECT_LISTING_DRAFT });
  }, [requireLogin, resetImageSearchState, user?.id]);

  const closeDirectListingDialog = useCallback(() => {
    setDirectListingDraft((current) => {
      if (current?.imagePreviewUrl) {
        URL.revokeObjectURL(current.imagePreviewUrl);
      }
      return null;
    });
    setIsSubmittingDirectListing(false);
  }, []);

  const setDirectListingImage = useCallback((file: File | null) => {
    if (!file) return;
    const isImage =
      file.type.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(file.name);
    if (!isImage) {
      showToast("请上传 PNG、JPG、WebP 或 GIF 图片", "error");
      return;
    }
    if (file.size > DIRECT_LISTING_MAX_IMAGE_BYTES) {
      showToast("上架图片需小于 10MB", "error");
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setDirectListingDraft((current) => {
      if (!current) {
        URL.revokeObjectURL(nextPreviewUrl);
        return current;
      }
      if (current.imagePreviewUrl) {
        URL.revokeObjectURL(current.imagePreviewUrl);
      }
      return {
        ...current,
        imageFile: file,
        imagePreviewUrl: nextPreviewUrl,
        title: current.title.trim() ? current.title : getFileTitle(file.name),
      };
    });
  }, []);

  const setDirectListingPsd = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".psd")) {
      showToast("只支持上传 PSD 文件", "error");
      return;
    }
    if (file.size <= 0 || file.size > DIRECT_LISTING_MAX_PSD_BYTES) {
      showToast("PSD 文件需小于 120MB", "error");
      return;
    }
    setDirectListingDraft((current) =>
      current ? { ...current, psdFile: file } : current,
    );
  }, []);

  const submitDirectListing = useCallback(async () => {
    if (!user?.id) {
      requireLogin("/market");
      return;
    }
    if (!directListingDraft?.imageFile) {
      showToast("请先上传要上架的图片", "error");
      return;
    }

    const title = directListingDraft.title.trim();
    const pricePoints = Math.max(
      1,
      Math.min(9999, Math.floor(Number(directListingDraft.pricePoints) || 0)),
    );
    if (!title) {
      showToast("请填写素材标题", "error");
      return;
    }
    if (!Number.isFinite(pricePoints) || pricePoints < 1) {
      showToast("售价积分需大于 0", "error");
      return;
    }

    setIsSubmittingDirectListing(true);
    try {
      const formData = new FormData();
      formData.append("imageFile", directListingDraft.imageFile);
      formData.append("title", title);
      formData.append("description", directListingDraft.description.trim());
      formData.append("category", directListingDraft.category.trim() || "手机壳图案");
      formData.append("tags", directListingDraft.tags.trim());
      formData.append("pricePoints", String(pricePoints));
      if (directListingDraft.psdFile) {
        formData.append("psdMode", "upload");
        formData.append("psdFile", directListingDraft.psdFile);
      } else {
        formData.append("psdMode", "none");
      }

      const response = await fetch("/api/market/listings", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await parseJsonApiResponse<ApiResponse<MarketItem>>(
        response,
        "提交上架失败",
      );
      if (!response.ok || !data.success || !data.data) {
        throw new Error(toUserFacingErrorMessage(data.message, "提交上架失败"));
      }

      showToast("已提交审核，审核通过后会展示到图市", "success");
      closeDirectListingDialog();
      setActiveTab("mine");
      marketBrowseLockedRef.current = true;
      setMarketBrowseLocked(true);
      setItems((current) => [
        data.data as MarketItem,
        ...current.filter((item) => item.id !== data.data?.id),
      ]);
      window.dispatchEvent(new CustomEvent("marketPendingChanged"));
      void loadMarketStats();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showToast(toUserFacingErrorFromUnknown(error, "提交上架失败"), "error");
    } finally {
      setIsSubmittingDirectListing(false);
    }
  }, [
    closeDirectListingDialog,
    directListingDraft,
    loadMarketStats,
    requireLogin,
    user?.id,
  ]);

  const runImageSearch = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        showToast("请选择图片文件", "error");
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        showToast("参考图片需小于 12MB", "error");
        return;
      }

      setActiveTab("market");
      setImageSearchLoading(true);
      setLoading(true);
      setImageSearchActive(true);
      setImageSearchFileName(file.name);
      setImageSearchPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(file);
      });

      try {
        const formData = new FormData();
        formData.append("image", file);
        if (keyword.trim()) formData.append("keyword", keyword.trim());
        const response = await fetch("/api/market/image-search", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        const data = await parseJsonApiResponse<ApiResponse<MarketItem[]>>(
          response,
          "以图搜图失败",
        );
        if (!response.ok || !data.success || !Array.isArray(data.data)) {
          throw new Error(
            toUserFacingErrorMessage(data.message, "以图搜图失败"),
          );
        }
        setItems(data.data);
        showToast(
          data.data.length > 0 ? "已按图案相似度排序" : "没有找到相似图案",
          data.data.length > 0 ? "success" : "info",
        );
        setTimeout(() => {
          scrollToBrowseMarket();
        }, 120);
      } catch (error) {
        showToast(toUserFacingErrorFromUnknown(error, "以图搜图失败"), "error");
        resetImageSearchState();
      } finally {
        setImageSearchLoading(false);
        setLoading(false);
        if (imageSearchInputRef.current) {
          imageSearchInputRef.current.value = "";
        }
      }
    },
    [keyword, resetImageSearchState, scrollToBrowseMarket],
  );

  useEffect(() => {
    if (activeTab !== "market" || marketBrowseLocked) return;

    const handleMarketLockScroll = () => {
      if (marketReturningTopRef.current) return;
      if (marketBrowseLockedRef.current) return;
      const browseSection = browseSectionRef.current;
      if (!browseSection) return;
      const browseTop = browseSection.getBoundingClientRect().top;
      if (browseTop <= -window.innerHeight * 0.08) {
        lockMarketBrowse();
      }
    };

    window.addEventListener("scroll", handleMarketLockScroll, {
      passive: true,
    });
    handleMarketLockScroll();
    return () => window.removeEventListener("scroll", handleMarketLockScroll);
  }, [activeTab, lockMarketBrowse, marketBrowseLocked]);

  useEffect(() => {
    const updateToolbarReveal = () => {
      if (activeTab !== "market" || marketBrowseLockedRef.current) {
        setMarketToolbarReveal(1);
        return;
      }

      const browseSection = browseSectionRef.current;
      if (!browseSection) {
        setMarketToolbarReveal(0);
        return;
      }

      const browseTop = browseSection.getBoundingClientRect().top;
      const revealStart = Math.min(window.innerHeight * 0.48, 360);
      const revealEnd = Math.min(window.innerHeight * 0.16, 128);
      const progress = clampNumber(
        (revealStart - browseTop) / Math.max(1, revealStart - revealEnd),
        0,
        1,
      );
      setMarketToolbarReveal(progress);
    };

    updateToolbarReveal();
    window.addEventListener("scroll", updateToolbarReveal, { passive: true });
    window.addEventListener("resize", updateToolbarReveal);
    return () => {
      window.removeEventListener("scroll", updateToolbarReveal);
      window.removeEventListener("resize", updateToolbarReveal);
    };
  }, [activeTab, marketBrowseLocked]);

  useEffect(() => {
    const handleScroll = () => {
      setShowMarketBackToTop(
        window.scrollY > 420 || marketBrowseLockedRef.current,
      );
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const rememberMarketImageRatio = useCallback(
    (itemId: string, image: HTMLImageElement) => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const nextRatio = clampNumber(
        image.naturalHeight / image.naturalWidth,
        0.72,
        1.9,
      );
      setMarketImageRatios((current) => {
        const currentRatio = current[itemId];
        if (currentRatio && Math.abs(currentRatio - nextRatio) < 0.02)
          return current;
        return { ...current, [itemId]: nextRatio };
      });
    },
    [],
  );

  useEffect(() => {
    if (imageSearchActive || imageSearchLoading) return;
    void loadItems();
  }, [imageSearchActive, imageSearchLoading, loadItems]);

  useEffect(() => {
    return () => {
      if (imageSearchPreviewUrl) {
        URL.revokeObjectURL(imageSearchPreviewUrl);
      }
    };
  }, [imageSearchPreviewUrl]);

  useEffect(() => {
    return () => {
      if (directListingDraft?.imagePreviewUrl) {
        URL.revokeObjectURL(directListingDraft.imagePreviewUrl);
      }
    };
  }, [directListingDraft?.imagePreviewUrl]);

  useEffect(() => {
    void loadMarketStats();
  }, [loadMarketStats]);

  useEffect(() => {
    const stored = localStorage.getItem("market:thumbnail-size:v2");
    if (!stored) return;
    const parsed = Number(stored);
    if (Number.isFinite(parsed)) {
      queueMicrotask(() => {
        setMarketThumbnailSize(clampNumber(parsed, 180, 360));
      });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "market:thumbnail-size:v2",
      String(marketThumbnailSize),
    );
  }, [marketThumbnailSize]);

  useEffect(() => {
    const updateColumnCount = () => {
      const containerWidth =
        marketSectionRef.current?.clientWidth || window.innerWidth - 260;
      const usableWidth = Math.max(320, containerWidth - 16);
      const nextCount = clampNumber(
        Math.floor(usableWidth / (marketThumbnailSize + marketThumbnailGap)),
        2,
        10,
      );
      setMarketColumnCount(nextCount);
    };

    updateColumnCount();
    window.addEventListener("resize", updateColumnCount);
    return () => window.removeEventListener("resize", updateColumnCount);
  }, [marketThumbnailGap, marketThumbnailSize]);

  const requestPsdPreview = useCallback(
    async (item: MarketItem, force = false) => {
      if (!item.psdUrl) return;
      if (!force && item.psdLayers && item.psdLayers.length > 0) return;
      if (psdPreviewingItemId === item.id) return;

      setPsdPreviewingItemId(item.id);
      setPsdPreviewErrorByItemId((current) => ({ ...current, [item.id]: "" }));

      try {
        const response = await fetch("/api/market/psd-preview", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.id }),
        });
        const data = await parseJsonApiResponse<ApiResponse<MarketItem>>(
          response,
          "PSD 图层预览生成失败",
        );
        if (!response.ok || !data.success || !data.data) {
          throw new Error(
            toUserFacingErrorMessage(data.message, "PSD 图层预览生成失败"),
          );
        }

        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, ...data.data } : entry,
          ),
        );
        setSelectedItem((current) =>
          current?.id === item.id ? { ...current, ...data.data } : current,
        );
      } catch (error) {
        const message = toUserFacingErrorFromUnknown(
          error,
          "PSD 图层预览生成失败",
        );
        setPsdPreviewErrorByItemId((current) => ({
          ...current,
          [item.id]: message,
        }));
        showToast(message, "error");
      } finally {
        setPsdPreviewingItemId("");
      }
    },
    [psdPreviewingItemId],
  );

  useEffect(() => {
    if (!selectedItem?.psdUrl) return;
    if (selectedItem.psdLayers && selectedItem.psdLayers.length > 0) return;
    if (psdPreviewErrorByItemId[selectedItem.id]) return;
    void requestPsdPreview(selectedItem);
  }, [psdPreviewErrorByItemId, requestPsdPreview, selectedItem]);

  useEffect(() => {
    setSelectedLayerPreviewId("source");
  }, [selectedItem?.id]);

  const purchaseItem = useCallback(
    async (item: MarketItem) => {
      setBusyItemId(item.id);
      try {
        const response = await fetch("/api/market/purchase", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: item.id }),
        });
        const data = await parseJsonApiResponse<
          ApiResponse<{ buyerRemainingPoints: number }>
        >(response, "购买失败");
        if (!response.ok || !data.success || !data.data) {
          throw new Error(toUserFacingErrorMessage(data.message, "购买失败"));
        }
        setPoints(data.data.buyerRemainingPoints);
        window.dispatchEvent(
          new CustomEvent("userPointsChanged", {
            detail: { points: data.data.buyerRemainingPoints },
          }),
        );
        showToast("购买成功，可直接下载素材", "success");
        await loadItems();
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, purchased: true } : entry,
          ),
        );
        setPurchaseCompletedItemId(item.id);
        setSelectedItem((current) =>
          current?.id === item.id ? { ...current, purchased: true } : current,
        );
      } catch (error) {
        showToast(toUserFacingErrorFromUnknown(error, "购买失败"), "error");
      } finally {
        setBusyItemId("");
      }
    },
    [loadItems, setPoints],
  );

  const downloadItem = useCallback(
    async (item: MarketItem, type: "image" | "psd") => {
      setBusyItemId(`${item.id}-${type}`);
      try {
        const params = new URLSearchParams({ itemId: item.id, type });
        const response = await fetch(
          `/api/market/download?${params.toString()}`,
          { credentials: "include" },
        );
        const data = await parseJsonApiResponse<ApiResponse<{ url: string }>>(
          response,
          "下载失败",
        );
        if (!response.ok || !data.success || !data.data?.url) {
          throw new Error(toUserFacingErrorMessage(data.message, "下载失败"));
        }
        window.open(data.data.url, "_blank", "noopener,noreferrer");
      } catch (error) {
        showToast(toUserFacingErrorFromUnknown(error, "下载失败"), "error");
      } finally {
        setBusyItemId("");
      }
    },
    [],
  );

  const reviewItem = useCallback(
    async (item: MarketItem, status: "approved" | "rejected") => {
      setBusyItemId(item.id);
      try {
        const rejectionReason =
          status === "rejected"
            ? window.prompt("请输入驳回原因", "质量或版权信息不符合上架要求") ||
              ""
            : "";
        const response = await fetch("/api/market/listings", {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, status, rejectionReason }),
        });
        const data = await parseJsonApiResponse<ApiResponse<MarketItem>>(
          response,
          "审核失败",
        );
        if (!response.ok || !data.success) {
          throw new Error(toUserFacingErrorMessage(data.message, "审核失败"));
        }
        showToast(status === "approved" ? "已通过审核" : "已驳回", "success");
        await loadItems();
        void loadMarketStats();
        window.dispatchEvent(new CustomEvent("marketPendingChanged"));
        setSelectedItem(null);
      } catch (error) {
        showToast(toUserFacingErrorFromUnknown(error, "审核失败"), "error");
      } finally {
        setBusyItemId("");
      }
    },
    [loadItems],
  );

  const canDownloadSelected =
    selectedItem &&
    (selectedItem.purchased || selectedItem.sellerId === user?.id);
  const canPurchaseSelected = Boolean(
    selectedItem &&
    selectedItem.status === "approved" &&
    !selectedItem.purchased &&
    selectedItem.sellerId !== user?.id,
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-950 to-black" />
        <div className="absolute left-1/4 top-1/4 h-[720px] w-[720px] rounded-full bg-purple-600/12 blur-[120px]" />
        <div className="absolute bottom-16 right-1/4 h-[620px] w-[620px] rounded-full bg-blue-600/10 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              "linear-gradient(rgba(147,51,234,.2) 1px, transparent 1px), linear-gradient(90deg, rgba(147,51,234,.2) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="relative z-10">
        <Navbar />
        <Sidebar activeTab="market" onTabChange={() => undefined} />

        <main className="px-3 pb-28 sm:pl-24 sm:pr-8 sm:pb-0">
          <section
            ref={marketSectionRef}
            className="mx-auto max-w-[1680px] px-0 py-4 sm:px-4 sm:py-8"
          >
            <style>{`
              @keyframes marketHeroDrift {
                from { transform: translate3d(0, var(--market-drift-from), 0) scale(1.01); }
                to { transform: translate3d(0, var(--market-drift-to), 0) scale(1.01); }
              }
              .market-hero-flow {
                --market-drift-from: -18%;
                --market-drift-to: -22%;
                animation: marketHeroDrift 22s ease-in-out infinite alternate;
              }
              .market-hero-flow-reverse {
                --market-drift-from: -10%;
                --market-drift-to: -6%;
                animation-duration: 26s;
              }
              .market-still-image {
                animation: none !important;
                transition: none !important;
                transform: none !important;
                backface-visibility: hidden;
              }
              .market-still-card {
                transition: border-color 160ms ease, background-color 160ms ease;
              }
              @media (prefers-reduced-motion: reduce) {
                .market-hero-flow { animation: none; transform: translate3d(0, -18%, 0); }
                .market-hero-flow-reverse { transform: translate3d(0, -10%, 0); }
              }
            `}</style>

            {activeTab === "market" && !marketBrowseLocked ? (
              <section className="relative left-1/2 mb-[-12vh] min-h-[calc(100svh-8rem)] w-screen -translate-x-1/2 overflow-hidden pb-[18vh] sm:-ml-8 sm:mb-[-22vh] sm:min-h-[calc(100vh-5rem)] sm:pb-[28vh]">
                <div className="absolute inset-0">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(99,102,241,0.24),transparent_35%),radial-gradient(circle_at_52%_82%,rgba(168,85,247,0.18),transparent_36%)]" />
                  <div className="absolute inset-0 bg-black/24" />
                  <div
                    className="absolute inset-y-[-24%] left-[-2%] right-[-2%] grid gap-3 opacity-62 blur-[0.2px] sm:gap-4"
                    style={{
                      gridTemplateColumns: `repeat(${MARKET_HERO_COLUMN_COUNT}, minmax(0, 1fr))`,
                    }}
                  >
                    {heroImageColumns.map((column, columnIndex) => (
                      <div
                        key={`market-hero-flow-${columnIndex}`}
                        className={`market-hero-flow flex flex-col gap-1 ${columnIndex % 2 === 1 ? "market-hero-flow-reverse pt-8" : ""}`}
                      >
                        {column.length > 0
                          ? column.map((image, imageIndex) => (
                              <div
                                key={`${image.id}-${imageIndex}`}
                                className="aspect-[9/16] overflow-hidden rounded-[1.05rem] border border-white/10 bg-black/20 shadow-[0_10px_28px_rgba(0,0,0,0.22)] sm:rounded-[1.18rem]"
                              >
                                {image.url ? (
                                  <img
                                    src={getDisplayImageUrl(image.url)}
                                    alt={image.title}
                                    loading="lazy"
                                    decoding="async"
                                    className="market-still-image h-full w-full object-cover"
                                  />
                                ) : (
                                  <div
                                    aria-hidden="true"
                                    className="h-full w-full"
                                    style={{
                                      backgroundImage: [
                                        "radial-gradient(circle at 35% 30%, rgba(125, 211, 252, 0.18), transparent 38%), linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.015))",
                                        "radial-gradient(circle at 68% 24%, rgba(196, 181, 253, 0.2), transparent 36%), linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.012))",
                                        "radial-gradient(circle at 44% 68%, rgba(52, 211, 153, 0.16), transparent 34%), linear-gradient(135deg, rgba(255,255,255,0.065), rgba(255,255,255,0.012))",
                                        "radial-gradient(circle at 70% 68%, rgba(251, 191, 36, 0.14), transparent 32%), linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.012))",
                                      ][image.toneIndex || 0],
                                    }}
                                  />
                                )}
                              </div>
                            ))
                          : Array.from({ length: 6 }, (_, index) => (
                              <div
                                key={`market-hero-placeholder-${columnIndex}-${index}`}
                                className="rounded-[1.35rem] border border-white/10 bg-white/[0.045]"
                                style={{
                                  height: columnIndex % 2 === 0 ? 315 : 368,
                                }}
                              />
                            ))}
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.76),rgba(0,0,0,0.28)_28%,rgba(0,0,0,0.28)_72%,rgba(0,0,0,0.76))]" />
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.66),rgba(0,0,0,0.1)_42%,rgba(0,0,0,0.66)_78%,rgba(0,0,0,0.94))]" />
                  <div className="absolute inset-x-0 bottom-0 h-[46vh] bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.16)_18%,rgba(0,0,0,0.48)_58%,rgba(0,0,0,0.92))]" />
                </div>

                <div className="relative z-10 flex min-h-[calc(100svh-8rem)] flex-col px-5 py-5 sm:min-h-[calc(100vh-5rem)] sm:pl-[8rem] sm:pr-8">
                  <div className="flex flex-1 items-center justify-center py-7 sm:py-10">
                    <div className="w-full max-w-3xl text-center">
                      <p className="mb-3 text-xs font-medium tracking-[0.22em] text-cyan-100/72 sm:mb-4 sm:text-sm">
                        IMAGE TO MARKET
                      </p>
                      <h1 className="text-3xl font-semibold leading-tight tracking-normal text-white sm:text-6xl">
                        上传主图，找到手机壳图案
                      </h1>
                      <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/58 sm:mt-5 sm:text-lg">
                        自动识别电商主图里的手机壳背面彩绘，优先匹配可购买素材和
                        PSD。游客可先搜索和浏览，详情、下载和更多素材登录后开放。
                      </p>

                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => imageSearchInputRef.current?.click()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            imageSearchInputRef.current?.click();
                          }
                        }}
                        onDragEnter={(event) => {
                          event.preventDefault();
                          setIsImageSearchDragging(true);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          setIsImageSearchDragging(true);
                        }}
                        onDragLeave={(event) => {
                          event.preventDefault();
                          setIsImageSearchDragging(false);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          setIsImageSearchDragging(false);
                          const file = event.dataTransfer.files?.[0];
                          if (file) void runImageSearch(file);
                        }}
                        className={`mx-auto mt-6 flex min-h-[132px] max-w-2xl cursor-pointer flex-col items-center justify-center rounded-[1.45rem] border px-5 py-6 text-center backdrop-blur-2xl transition-all sm:mt-8 sm:min-h-[168px] sm:rounded-[1.7rem] sm:px-6 sm:py-8 ${isImageSearchDragging ? "border-cyan-200/70 bg-cyan-300/[0.16] shadow-[0_0_60px_rgba(103,232,249,0.24)]" : "border-cyan-200/22 bg-black/42 hover:border-cyan-100/45 hover:bg-cyan-300/[0.075]"}`}
                      >
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-100/22 bg-cyan-300/[0.12] text-cyan-100">
                          <svg
                            className={`h-7 w-7 ${imageSearchLoading ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            {imageSearchLoading ? (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.7}
                                d="M12 3a9 9 0 1 1-6.36 2.64"
                              />
                            ) : (
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.7}
                                d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm-2.25-7.5h4.5M10.5 8.25v4.5"
                              />
                            )}
                          </svg>
                        </div>
                        <p className="text-lg font-semibold text-white">
                          {imageSearchLoading
                            ? "正在识别主图里的图案"
                            : "选择图片搜索"}
                        </p>
                        <p className="mt-2 text-sm text-white/42">
                          支持拖拽上传，适合手机壳电商主图、详情图和买家秀图。
                        </p>
                      </div>

                      <div className="pointer-events-none mx-auto mt-7 flex flex-col items-center text-center">
                        <span className="text-sm font-semibold tracking-[0.16em] text-cyan-200/88 drop-shadow-[0_0_14px_rgba(103,232,249,0.28)]">
                          下滑浏览热门素材
                        </span>
                        <span className="relative mt-2 grid h-11 w-11 place-items-center text-cyan-200 motion-safe:animate-bounce">
                          <span className="absolute inset-1 rounded-full bg-cyan-300/12 blur-xl" />
                          <svg
                            className="relative h-8 w-8 drop-shadow-[0_0_16px_rgba(103,232,249,0.36)]"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="m5.5 7.5 6.5 6.5 6.5-6.5M5.5 13l6.5 6.5L18.5 13"
                            />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            <div
              ref={browseSectionRef}
              data-market-browse="true"
              className={`relative z-20 scroll-mt-24 pb-[70vh] ${activeTab === "market" ? (marketBrowseLocked ? "pt-2" : "pt-[12vh]") : "pt-4"}`}
            >
              {activeTab === "market" && !marketBrowseLocked ? (
                <div className="pointer-events-none absolute inset-x-[-2rem] top-[-24vh] -z-10 h-[42vh] bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.42)_38%,rgba(0,0,0,0.88)_72%,transparent)]" />
              ) : null}
              <div
                data-market-toolbar="true"
                data-active-market={activeTab === "market" ? "true" : "false"}
                className={`${marketToolbarPinned ? "fixed left-3 right-3 top-[64px] sm:left-24 sm:right-8" : "sticky top-20 mb-6 overflow-hidden"} z-50 flex flex-wrap items-center justify-between gap-2 rounded-[1.45rem] border border-white/10 bg-black/78 p-2 shadow-[0_14px_44px_rgba(0,0,0,0.32)] backdrop-blur-2xl transition-[opacity,transform,max-height,margin,padding] duration-200 sm:gap-3 sm:rounded-[1.6rem]`}
                style={
                  marketToolbarPinned
                    ? undefined
                    : {
                        opacity: marketToolbarReveal,
                        transform: `translateY(${Math.round((1 - marketToolbarReveal) * 14)}px)`,
                        maxHeight: marketToolbarReveal > 0.12 ? "132px" : "0px",
                        marginBottom:
                          marketToolbarReveal > 0.12 ? "24px" : "0px",
                        padding: marketToolbarReveal > 0.12 ? "8px" : "0px",
                        pointerEvents:
                          marketToolbarReveal < 0.72 ? "none" : "auto",
                      }
                }
              >
                <div className="flex w-full flex-wrap items-center gap-2">
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => {
                        if (!user?.id && tab.key !== "market") {
                          requireLogin(`/market?tab=${tab.key}`);
                          return;
                        }
                        if (imageSearchActive || imageSearchLoading) {
                          resetImageSearchState();
                        }
                        setActiveTab(tab.key);
                      }}
                      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-all ${activeTab === tab.key ? "bg-white/16 text-white" : "text-white/48 hover:bg-white/[0.08] hover:text-white/80"}`}
                    >
                      <span>{tab.label}</span>
                      {tab.key === "pending" &&
                      typeof tab.count === "number" &&
                      tab.count > 0 ? (
                        <span className="rounded-full bg-amber-300 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-black">
                          {tab.count}
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {activeTab === "market" ? (
                    <span className="hidden pl-2 text-xs text-white/38 lg:inline-flex">
                      手机壳彩绘素材包市场，支持积分购买和 PSD 图层预览。
                    </span>
                  ) : null}
                </div>
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <div className="flex min-w-[min(100%,240px)] flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 sm:flex-none">
                      <input
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder="搜索标题、分类、描述"
                        className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            runKeywordSearch();
                          }
                        }}
                      />
                      <button
                        type="button"
                        onClick={runKeywordSearch}
                        className="rounded-full border border-white/10 bg-white/[0.075] px-2.5 py-1 text-xs font-medium text-white/72 transition hover:border-white/18 hover:bg-white/[0.13] hover:text-white"
                      >
                        搜索
                      </button>
                    </div>
                    <input
                      ref={imageSearchInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void runImageSearch(file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => imageSearchInputRef.current?.click()}
                      disabled={imageSearchLoading}
                      className="inline-flex items-center gap-2 rounded-full border border-cyan-300/18 bg-cyan-300/[0.075] px-3 py-2 text-xs font-medium text-cyan-100 transition hover:border-cyan-200/35 hover:bg-cyan-300/[0.12] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <svg
                        className={`h-4 w-4 ${imageSearchLoading ? "animate-spin" : ""}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        {imageSearchLoading ? (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.7}
                            d="M12 3a9 9 0 1 1-6.36 2.64"
                          />
                        ) : (
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.7}
                            d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm-2.25-7.5h4.5M10.5 8.25v4.5"
                          />
                        )}
                      </svg>
                      <span>{imageSearchLoading ? "识别中" : "以图搜图"}</span>
                    </button>
                  </div>
                  <label
                    className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-2 text-[11px] text-white/38 transition hover:bg-white/[0.055] hover:text-white/58 lg:flex"
                    title={`缩略图大小：${marketThumbnailSize}px`}
                  >
                    <svg
                      className="h-3.5 w-3.5 text-white/32"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.7}
                        d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z"
                      />
                    </svg>
                    <span className="select-none text-white/34">小</span>
                    <input
                      type="range"
                      min="180"
                      max="360"
                      step="10"
                      value={marketThumbnailSize}
                      onChange={(event) =>
                        setMarketThumbnailSize(Number(event.target.value))
                      }
                      className="zaomeng-subtle-range w-20"
                    />
                    <span className="select-none text-white/34">大</span>
                  </label>
                </div>
              </div>
              {marketToolbarPinned ? (
                <div className="h-[104px]" aria-hidden="true" />
              ) : null}
              {imageSearchActive ? (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.3rem] border border-cyan-300/14 bg-cyan-300/[0.055] px-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/35">
                      {imageSearchPreviewUrl ? (
                        <img
                          src={imageSearchPreviewUrl}
                          alt="以图搜图参考图"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-cyan-50">
                        {imageSearchLoading
                          ? "正在识别主图里的手机壳图案"
                          : "已按手机壳图案相似度排序"}
                      </p>
                      <p className="mt-1 truncate text-xs text-cyan-100/42">
                        {imageSearchFileName || "电商主图"}
                        {keyword.trim() ? ` / 关键词：${keyword.trim()}` : ""}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearImageSearch}
                    className="rounded-full border border-white/12 bg-white/[0.055] px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/[0.1] hover:text-white"
                  >
                    清除图搜
                  </button>
                </div>
              ) : null}

              {loading ? (
                <div
                  className="flex items-start justify-center"
                  style={{ gap: `${marketThumbnailGap}px` }}
                >
                  {Array.from(
                    { length: marketColumnCount },
                    (_, columnIndex) => (
                      <div
                        key={`market-skeleton-column-${columnIndex}`}
                        className="min-w-0 space-y-5"
                        style={{
                          width: `${marketThumbnailSize}px`,
                          maxWidth: `${marketThumbnailSize}px`,
                        }}
                      >
                        {Array.from({ length: 2 }, (_, itemIndex) => (
                          <div
                            key={`market-skeleton-card-${columnIndex}-${itemIndex}`}
                            className="relative overflow-hidden rounded-[1.35rem] border border-white/8 bg-white/[0.05]"
                            style={{
                              height: Math.max(
                                180,
                                Math.min(
                                  420,
                                  marketThumbnailSize *
                                    (0.86 +
                                      ((columnIndex + itemIndex) % 3) * 0.2),
                                ),
                              ),
                            }}
                          >
                            <div className="absolute inset-0 animate-pulse bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.08),transparent)]" />
                          </div>
                        ))}
                      </div>
                    ),
                  )}
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-[2rem] border border-white/10 bg-white/[0.035] px-8 py-16 text-center">
                  <p className="text-lg font-medium text-white/70">暂无素材</p>
                  <p className="mt-2 text-sm text-white/40">
                    可以从订单结果图点击“上架”提交到图市。
                  </p>
                </div>
              ) : (
                <div
                  className="flex items-start justify-center"
                  style={{ gap: `${marketThumbnailGap}px` }}
                >
                  {marketMasonryColumns.map((column, columnIndex) => (
                    <div
                      key={`market-column-${columnIndex}`}
                      className="min-w-0 space-y-5"
                      style={{
                        width: `${marketThumbnailSize}px`,
                        maxWidth: `${marketThumbnailSize}px`,
                      }}
                    >
                      {column.map((item) => {
                        const imageUrl =
                          item.thumbnailUrl || item.previewImageUrl;
                        const imageRatio =
                          marketImageRatios[item.id] ??
                          getStableMarketImageRatio(item.id);
                        const openItemDetail = () => {
                          if (!user?.id) {
                            requireLogin(`/market?item=${item.id}`);
                            return;
                          }
                          setSelectedLayerPreviewId("source");
                          setSelectedItem(item);
                        };

                        return (
                          <article
                            key={item.id}
                            className="market-still-card group w-full overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.035] text-left hover:border-white/24 hover:bg-white/[0.06]"
                          >
                            <button
                              type="button"
                              onClick={openItemDetail}
                              className="block w-full text-left"
                              aria-label={`查看${item.title}`}
                            >
                              <div
                                className="relative overflow-hidden bg-black/30"
                                style={{ aspectRatio: `${1 / imageRatio}` }}
                              >
                                <img
                                  src={getDisplayImageUrl(imageUrl)}
                                  alt={item.title}
                                  loading="lazy"
                                  decoding="async"
                                  onLoad={(event) =>
                                    rememberMarketImageRatio(
                                      item.id,
                                      event.currentTarget,
                                    )
                                  }
                                  className="market-still-image h-full w-full object-cover"
                                />
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
                                {item.psdUrl ? (
                                  <span className="absolute left-3 top-3 rounded-full border border-[#31a8ff]/25 bg-[#001e36]/88 px-2 py-1 text-[11px] font-semibold text-[#31a8ff]">
                                    PSD
                                    {item.psdLayerCount
                                      ? ` ${item.psdLayerCount}层`
                                      : ""}
                                  </span>
                                ) : null}
                                {item.purchased ? (
                                  <span className="absolute right-3 top-3 rounded-full border border-emerald-300/25 bg-emerald-500/22 px-2 py-1 text-[11px] text-emerald-100">
                                    已购
                                  </span>
                                ) : null}
                                {typeof item.similarityScore === "number" ? (
                                  <span className="absolute bottom-3 left-3 rounded-full border border-cyan-200/24 bg-cyan-400/18 px-2 py-1 text-[11px] text-cyan-50">
                                    相似{" "}
                                    {Math.round(item.similarityScore * 100)}%
                                  </span>
                                ) : null}
                              </div>
                            </button>
                            <div className="space-y-2 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <p className="line-clamp-2 text-sm font-medium text-white/86">
                                  {item.title}
                                </p>
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-yellow-500/12 px-2 py-1 text-[11px] text-yellow-200">
                                  <Image
                                    src="/points-icon.png"
                                    alt=""
                                    aria-hidden="true"
                                    width={12}
                                    height={12}
                                    className="h-3 w-3"
                                  />
                                  <span>{item.pricePoints}</span>
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/38">
                                <span>{item.category}</span>
                                <span>/</span>
                                <span>{item.sellerName || "创作者"}</span>
                                <span>/</span>
                                <span>{formatDate(item.createdAt)}</span>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {hasMorePublicItems ? (
                <div className="mt-8 flex justify-center">
                  <button
                    type="button"
                    onClick={() => requireLogin("/market")}
                    className="rounded-full border border-white/14 bg-white px-5 py-2.5 text-sm font-semibold text-black shadow-[0_14px_34px_rgba(255,255,255,0.12)] transition hover:bg-cyan-50"
                  >
                    加载更多素材
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </main>
      </div>

      <div className="fixed bottom-24 right-4 z-[80] flex flex-col items-center gap-3 sm:bottom-6 sm:right-6">
        <button
          type="button"
          onClick={openMarketListingEntry}
          aria-label="上架卖图"
          title="上架卖图"
          className="group grid h-11 w-11 place-items-center rounded-full bg-transparent p-0 text-emerald-50 transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/50"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full border border-emerald-200/18 bg-emerald-300/[0.12] shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition group-hover:border-emerald-100/42 group-hover:bg-emerald-300/[0.18]">
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M5 20h14"
              />
            </svg>
          </span>
          <span className="sr-only">上架卖图</span>
        </button>

        <button
          type="button"
          onClick={scrollToMarketTop}
          aria-label="回到图市顶部"
          title="回到顶部"
          className={`group grid h-9 w-9 place-items-center rounded-full bg-transparent p-0 text-white/62 transition-all duration-300 hover:translate-y-2 hover:text-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#31a8ff]/45 ${showMarketBackToTop ? "translate-y-2 opacity-100" : "pointer-events-none translate-y-5 opacity-0"}`}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-black/56 shadow-[0_12px_32px_rgba(0,0,0,0.24)] backdrop-blur-2xl transition group-hover:border-[#31a8ff]/34 group-hover:bg-white/[0.1]">
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M12 19V5m0 0 6 6M12 5l-6 6"
              />
            </svg>
          </span>
          <span className="sr-only">回到顶部</span>
        </button>
      </div>

      {directListingDraft ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/78 px-4 py-6 backdrop-blur-md"
          onClick={() => {
            if (!isSubmittingDirectListing) closeDirectListingDialog();
          }}
        >
          <div
            className="grid max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[1.65rem] border border-white/12 bg-[#07080c]/96 shadow-[0_28px_96px_rgba(0,0,0,0.58)] lg:grid-cols-[minmax(0,0.92fr)_minmax(360px,0.9fr)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="min-h-[360px] bg-[radial-gradient(circle_at_35%_18%,rgba(52,211,153,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015))] p-4 sm:p-5">
              <label
                className="group relative flex h-full min-h-[360px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[1.35rem] border border-dashed border-emerald-200/22 bg-black/34 p-5 text-center transition hover:border-emerald-100/48 hover:bg-emerald-300/[0.055]"
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDirectListingImage(event.dataTransfer.files.item(0));
                }}
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="sr-only"
                  disabled={isSubmittingDirectListing}
                  onChange={(event) => {
                    setDirectListingImage(event.currentTarget.files?.item(0) || null);
                    event.currentTarget.value = "";
                  }}
                />
                {directListingDraft.imagePreviewUrl ? (
                  <>
                    <SafeImage
                      src={directListingDraft.imagePreviewUrl}
                      alt="待上架图片预览"
                      fill
                      sizes="(min-width: 1024px) 48vw, 92vw"
                      className="object-contain p-5"
                    />
                    <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/10 bg-black/68 px-4 py-3 text-left shadow-[0_18px_42px_rgba(0,0,0,0.34)] backdrop-blur-xl">
                      <p className="text-sm font-semibold text-white">
                        {directListingDraft.imageFile?.name || "已选择图片"}
                      </p>
                      <p className="mt-1 text-xs text-white/52">
                        点击或拖拽可重新选择上架图片
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="relative z-10 flex max-w-sm flex-col items-center">
                    <span className="grid h-16 w-16 place-items-center rounded-full border border-emerald-100/20 bg-emerald-300/[0.12] text-emerald-100 shadow-[0_18px_48px_rgba(16,185,129,0.16)]">
                      <svg
                        className="h-7 w-7"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.7}
                          d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M5 20h14"
                        />
                      </svg>
                    </span>
                    <h2 className="mt-5 text-2xl font-semibold text-white">
                      上传图片上架
                    </h2>
                    <p className="mt-3 text-sm leading-6 text-white/54">
                      点击选择或直接拖拽图片到这里，填写标题、标签和售价后提交审核。
                    </p>
                    <p className="mt-3 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs text-white/42">
                      支持 PNG / JPG / WebP / GIF，最大 10MB
                    </p>
                  </div>
                )}
              </label>
            </div>

            <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/70">
                    Market Listing
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    自定义上架卖图
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-white/46">
                    上传自己的图案素材，提交后进入待审核，审核通过后用户可用积分购买。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDirectListingDialog}
                  disabled={isSubmittingDirectListing}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-white/58 transition hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="关闭上架弹窗"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.8}
                      d="M6 6l12 12M18 6 6 18"
                    />
                  </svg>
                </button>
              </div>

              <div className="mt-6 space-y-4">
                <label className="block">
                  <span className="text-sm font-medium text-white/72">
                    素材标题
                  </span>
                  <input
                    value={directListingDraft.title}
                    maxLength={120}
                    disabled={isSubmittingDirectListing}
                    onChange={(event) =>
                      setDirectListingDraft((current) =>
                        current ? { ...current, title: event.target.value } : current,
                      )
                    }
                    placeholder="例如：复古花卉手机壳图案"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/24 focus:border-emerald-200/36 focus:bg-white/[0.075]"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-white/72">
                    素材说明
                  </span>
                  <textarea
                    value={directListingDraft.description}
                    rows={4}
                    maxLength={1000}
                    disabled={isSubmittingDirectListing}
                    onChange={(event) =>
                      setDirectListingDraft((current) =>
                        current
                          ? { ...current, description: event.target.value }
                          : current,
                      )
                    }
                    className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/24 focus:border-emerald-200/36 focus:bg-white/[0.075]"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                  <label className="block">
                    <span className="text-sm font-medium text-white/72">
                      分类
                    </span>
                    <input
                      value={directListingDraft.category}
                      disabled={isSubmittingDirectListing}
                      onChange={(event) =>
                        setDirectListingDraft((current) =>
                          current
                            ? { ...current, category: event.target.value }
                            : current,
                        )
                      }
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-200/36 focus:bg-white/[0.075]"
                    />
                  </label>

                  <label className="block">
                    <span className="text-sm font-medium text-white/72">
                      售价积分
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={directListingDraft.pricePoints}
                      disabled={isSubmittingDirectListing}
                      onChange={(event) =>
                        setDirectListingDraft((current) =>
                          current
                            ? {
                                ...current,
                                pricePoints: Number(event.target.value) || 0,
                              }
                            : current,
                        )
                      }
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm text-white outline-none transition focus:border-emerald-200/36 focus:bg-white/[0.075]"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-sm font-medium text-white/72">
                    标签
                  </span>
                  <input
                    value={directListingDraft.tags}
                    disabled={isSubmittingDirectListing}
                    onChange={(event) =>
                      setDirectListingDraft((current) =>
                        current ? { ...current, tags: event.target.value } : current,
                      )
                    }
                    placeholder="用空格或逗号分隔，例如：手机壳 彩绘 花卉"
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/24 focus:border-emerald-200/36 focus:bg-white/[0.075]"
                  />
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 transition hover:border-white/18 hover:bg-white/[0.065]">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white/76">
                      PSD 图层文件（可选）
                    </p>
                    <p className="mt-1 truncate text-xs text-white/42">
                      {directListingDraft.psdFile
                        ? directListingDraft.psdFile.name
                        : "可上传 PSD，买家购买后可下载图层文件"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/12 bg-black/36 px-3 py-1.5 text-xs font-semibold text-white/64">
                    选择 PSD
                  </span>
                  <input
                    type="file"
                    accept=".psd,application/octet-stream"
                    className="sr-only"
                    disabled={isSubmittingDirectListing}
                    onChange={(event) => {
                      setDirectListingPsd(event.currentTarget.files?.item(0) || null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>

              <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeDirectListingDialog}
                  disabled={isSubmittingDirectListing}
                  className="rounded-full border border-white/10 bg-white/[0.045] px-5 py-3 text-sm font-semibold text-white/62 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitDirectListing}
                  disabled={
                    isSubmittingDirectListing || !directListingDraft.imageFile
                  }
                  className="rounded-full border border-emerald-100/28 bg-emerald-300 px-6 py-3 text-sm font-semibold text-black shadow-[0_16px_42px_rgba(52,211,153,0.2)] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.08] disabled:text-white/34 disabled:shadow-none"
                >
                  {isSubmittingDirectListing ? "提交中..." : "提交审核"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedItem ? (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/78 px-3 py-5 backdrop-blur-sm"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="grid max-h-[86vh] w-full max-w-6xl overflow-hidden rounded-[1.35rem] border border-white/12 bg-[#07070b]/96 shadow-[0_24px_76px_rgba(0,0,0,0.52)] lg:grid-cols-[minmax(0,1fr)_320px]"
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const selectedLayer =
                selectedLayerPreviewId === "source"
                  ? null
                  : selectedItem.psdLayers?.find(
                      (layer) => layer.id === selectedLayerPreviewId,
                    ) || null;
              const previewUrl =
                selectedLayer?.previewUrl || selectedItem.previewImageUrl;
              const previewTitle = selectedLayer
                ? selectedLayer.name
                : "整图预览";
              const isLayerPreview = Boolean(selectedLayer);
              const canAccessFullPreview =
                selectedItem.purchased ||
                selectedItem.sellerId === user?.id ||
                user?.isAdmin;
              const shouldProtectPreview = !canAccessFullPreview;
              const selectedLayerMeta = selectedLayer
                ? `${selectedLayer.width}x${selectedLayer.height}${selectedLayer.visible ? "" : " / 已隐藏"}`
                : `${selectedItem.psdLayerCount || selectedItem.psdLayers?.length || 0} 个PSD图层`;

              return (
                <>
                  <div className="min-h-0 overflow-y-auto bg-black/24 p-3 sm:p-4">
                    <div className="relative flex h-[min(54vh,620px)] min-h-[280px] items-center justify-center overflow-hidden rounded-[1.15rem] border border-white/10 bg-[#050507] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      {isLayerPreview ? (
                        <div
                          className="absolute inset-3 rounded-2xl opacity-55"
                          style={{
                            backgroundImage:
                              "linear-gradient(45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.08) 75%)",
                            backgroundPosition:
                              "0 0, 0 10px, 10px -10px, -10px 0px",
                            backgroundSize: "20px 20px",
                          }}
                        />
                      ) : (
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(74,92,180,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_36%)]" />
                      )}
                      {previewUrl ? (
                        <SafeImage
                          src={getDisplayImageUrl(previewUrl)}
                          alt={previewTitle}
                          fill
                          sizes="min(62vw, 820px)"
                          className="object-contain p-4"
                        />
                      ) : (
                        <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-white/34">
                          该图层暂无预览
                        </div>
                      )}
                      <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-1.5">
                        <span className="rounded-full border border-white/10 bg-black/62 px-2.5 py-1 text-[11px] text-white/72 backdrop-blur">
                          {previewTitle}
                        </span>
                        <span className="rounded-full border border-white/10 bg-black/52 px-2.5 py-1 text-[11px] text-white/46 backdrop-blur">
                          {selectedLayerMeta}
                        </span>
                      </div>
                      {shouldProtectPreview ? (
                        <div className="pointer-events-none absolute inset-0 overflow-hidden">
                          <div className="absolute right-4 top-4 rounded-full border border-white/12 bg-black/58 px-3 py-1.5 text-xs text-white/62 backdrop-blur">
                            购买前预览
                          </div>
                          <div className="absolute inset-[-20%] grid rotate-[-18deg] grid-cols-3 gap-8 opacity-[0.11]">
                            {Array.from({ length: 18 }).map((_, index) => (
                              <span
                                key={index}
                                className="whitespace-nowrap text-lg font-semibold text-white"
                              >
                                造梦AI 图市预览
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <section className="mt-3 rounded-[1.15rem] border border-white/10 bg-white/[0.032] p-3 sm:p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2.5">
                        <div className="min-w-0">
                          <h2 className="truncate text-lg font-semibold text-white">
                            {selectedItem.title}
                          </h2>
                          <p className="mt-1 text-xs text-white/42">
                            {selectedItem.category} /{" "}
                            {selectedItem.sellerName || "创作者"} /{" "}
                            {formatDate(selectedItem.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/20 bg-yellow-500/10 px-2.5 py-1.5 text-yellow-200">
                            <PointsIconLabel
                              points={selectedItem.pricePoints}
                              iconClassName="h-3.5 w-3.5"
                            />
                          </div>
                        </div>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-white/54">
                        {selectedItem.description ||
                          "购买后可用于商品铺货，不可二次转售素材文件。"}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(selectedItem.tags || []).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full border border-white/10 bg-white/[0.055] px-2 py-0.5 text-[11px] text-white/48"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <div className="mt-3 rounded-xl border border-white/10 bg-black/18 px-3 py-2 text-[11px] leading-5 text-white/38">
                        购买后可用于手机壳商品铺货、印刷打样和店铺展示；不提供独家买断，不允许二次转售素材包。
                      </div>
                      {purchaseCompletedItemId === selectedItem.id ? (
                        <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.08] p-3">
                          <p className="text-sm font-medium text-emerald-100">
                            购买成功，素材已加入已购记录。
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() =>
                                void downloadItem(selectedItem, "image")
                              }
                              disabled={
                                busyItemId === `${selectedItem.id}-image`
                              }
                              className="rounded-full bg-emerald-300 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-60"
                            >
                              下载原图
                            </button>
                            {selectedItem.psdUrl ? (
                              <button
                                onClick={() =>
                                  void downloadItem(selectedItem, "psd")
                                }
                                disabled={
                                  busyItemId === `${selectedItem.id}-psd`
                                }
                                className="rounded-full border border-[#31a8ff]/25 bg-[#001e36] px-3 py-1.5 text-xs font-semibold text-[#31a8ff] disabled:opacity-60"
                              >
                                下载PSD
                              </button>
                            ) : null}
                            <button
                              onClick={() => setActiveTab("purchased")}
                              className="rounded-full border border-white/12 bg-white/[0.06] px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/[0.1]"
                            >
                              查看已购
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                        {selectedItem.status === "pending" && user?.isAdmin ? (
                          <>
                            <button
                              onClick={() =>
                                void reviewItem(selectedItem, "approved")
                              }
                              disabled={busyItemId === selectedItem.id}
                              className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              通过
                            </button>
                            <button
                              onClick={() =>
                                void reviewItem(selectedItem, "rejected")
                              }
                              disabled={busyItemId === selectedItem.id}
                              className="rounded-full bg-red-500/80 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              驳回
                            </button>
                          </>
                        ) : canDownloadSelected ? (
                          <>
                            <button
                              onClick={() =>
                                void downloadItem(selectedItem, "image")
                              }
                              disabled={
                                busyItemId === `${selectedItem.id}-image`
                              }
                              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                            >
                              下载原图
                            </button>
                            {selectedItem.psdUrl ? (
                              <button
                                onClick={() =>
                                  void downloadItem(selectedItem, "psd")
                                }
                                disabled={
                                  busyItemId === `${selectedItem.id}-psd`
                                }
                                className="rounded-full border border-[#31a8ff]/25 bg-[#001e36] px-4 py-2 text-sm font-semibold text-[#31a8ff] disabled:opacity-60"
                              >
                                下载PSD
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <aside className="flex min-h-0 flex-col border-t border-white/10 bg-[#0b0b12]/90 p-3 lg:border-l lg:border-t-0">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white/88">
                          PSD 图层
                        </p>
                        <p className="mt-1 text-xs text-white/38">
                          {selectedItem.psdLayerCount ||
                            selectedItem.psdLayers?.length ||
                            0}{" "}
                          层 / 点击预览
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedItem(null)}
                        aria-label="关闭详情"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.055] text-white/50 transition hover:bg-white/[0.1] hover:text-white"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.8}
                            d="M6 6l12 12M18 6 6 18"
                          />
                        </svg>
                      </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      {selectedItem.psdUrl ? (
                        <div className="mb-2.5 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                            <p className="text-[11px] text-white/34">
                              文件类型
                            </p>
                            <p className="mt-1 text-xs font-medium text-[#9bdcff]">
                              PSD 素材包
                            </p>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                            <p className="text-[11px] text-white/34">
                              预览权限
                            </p>
                            <p className="mt-1 text-xs font-medium text-white/70">
                              {canAccessFullPreview ? "完整预览" : "水印预览"}
                            </p>
                          </div>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setSelectedLayerPreviewId("source")}
                        className={`mb-2.5 flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors ${selectedLayerPreviewId === "source" ? "border-[#31a8ff]/55 bg-[#31a8ff]/12" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.065]"}`}
                      >
                        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black/35">
                          <SafeImage
                            src={getDisplayImageUrl(
                              selectedItem.thumbnailUrl ||
                                selectedItem.previewImageUrl,
                            )}
                            alt="整图预览"
                            fill
                            sizes="48px"
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white/82">
                            整图预览
                          </p>
                          <p className="mt-1 text-xs text-white/38">
                            市场展示图
                          </p>
                        </div>
                      </button>

                      {selectedItem.psdUrl ? (
                        <>
                          {selectedItem.psdLayers &&
                          selectedItem.psdLayers.length > 0 ? (
                            <div className="space-y-2">
                              {selectedItem.psdLayers.map((layer) => (
                                <button
                                  key={layer.id}
                                  type="button"
                                  onClick={() =>
                                    setSelectedLayerPreviewId(layer.id)
                                  }
                                  className={`flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition-colors ${selectedLayerPreviewId === layer.id ? "border-[#31a8ff]/55 bg-[#31a8ff]/12" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.065]"}`}
                                >
                                  <div
                                    className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.035]"
                                    style={{
                                      backgroundImage:
                                        "linear-gradient(45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,.08) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,.08) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.08) 75%)",
                                      backgroundPosition:
                                        "0 0, 0 8px, 8px -8px, -8px 0px",
                                      backgroundSize: "16px 16px",
                                    }}
                                  >
                                    {layer.previewUrl ? (
                                      <SafeImage
                                        src={layer.previewUrl}
                                        alt={layer.name}
                                        fill
                                        sizes="48px"
                                        className="object-contain p-1"
                                      />
                                    ) : (
                                      <div className="flex h-full items-center justify-center text-[10px] text-white/28">
                                        无预览
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-white/78">
                                      {layer.name}
                                    </p>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-white/36">
                                      <span>
                                        {layer.width}x{layer.height}
                                      </span>
                                      {layer.previewUrl ? (
                                        <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/42">
                                          可预览
                                        </span>
                                      ) : null}
                                      {!layer.visible ? (
                                        <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/42">
                                          隐藏层
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : psdPreviewingItemId === selectedItem.id ? (
                            <div className="rounded-xl border border-[#31a8ff]/15 bg-[#31a8ff]/[0.06] px-3 py-4 text-xs text-[#b8e4ff]">
                              <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/10">
                                <div className="h-full w-1/2 animate-pulse rounded-full bg-[#31a8ff]" />
                              </div>
                              正在解析 PSD 图层...
                            </div>
                          ) : psdPreviewErrorByItemId[selectedItem.id] ? (
                            <div className="rounded-xl border border-amber-300/14 bg-amber-400/[0.055] p-3">
                              <p className="text-xs font-medium text-amber-100/90">
                                PSD 解析失败
                              </p>
                              <p className="mt-1 text-[11px] leading-4 text-amber-100/48">
                                图层暂不可预览，可继续查看整图。
                              </p>
                              <button
                                onClick={() =>
                                  void requestPsdPreview(selectedItem, true)
                                }
                                className="mt-2 rounded-full border border-amber-200/20 px-2.5 py-1 text-[11px] text-amber-100/78 transition-colors hover:bg-amber-300/12"
                              >
                                重新解析图层
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() =>
                                void requestPsdPreview(selectedItem, true)
                              }
                              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-xs text-white/52 transition-colors hover:bg-white/[0.08] hover:text-white"
                            >
                              解析 PSD 图层预览
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3 text-xs text-white/40">
                          该素材未附带 PSD 文件。
                        </div>
                      )}
                    </div>

                    <div className="mt-3 shrink-0 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-white/42">素材价格</span>
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/10 px-2.5 py-1 text-yellow-200">
                          <PointsIconLabel
                            points={selectedItem.pricePoints}
                            iconClassName="h-3.5 w-3.5"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {selectedItem.status === "pending" && user?.isAdmin ? (
                          <>
                            <button
                              onClick={() =>
                                void reviewItem(selectedItem, "approved")
                              }
                              disabled={busyItemId === selectedItem.id}
                              className="flex-1 rounded-full bg-emerald-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              通过
                            </button>
                            <button
                              onClick={() =>
                                void reviewItem(selectedItem, "rejected")
                              }
                              disabled={busyItemId === selectedItem.id}
                              className="flex-1 rounded-full bg-red-500/80 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            >
                              驳回
                            </button>
                          </>
                        ) : canDownloadSelected ? (
                          <>
                            <button
                              onClick={() =>
                                void downloadItem(selectedItem, "image")
                              }
                              disabled={
                                busyItemId === `${selectedItem.id}-image`
                              }
                              className="flex-1 rounded-full bg-white px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
                            >
                              下载原图
                            </button>
                            {selectedItem.psdUrl ? (
                              <button
                                onClick={() =>
                                  void downloadItem(selectedItem, "psd")
                                }
                                disabled={
                                  busyItemId === `${selectedItem.id}-psd`
                                }
                                className="flex-1 rounded-full border border-[#31a8ff]/25 bg-[#001e36] px-3 py-2 text-sm font-semibold text-[#31a8ff] disabled:opacity-60"
                              >
                                下载PSD
                              </button>
                            ) : null}
                          </>
                        ) : canPurchaseSelected ? (
                          <button
                            onClick={() => void purchaseItem(selectedItem)}
                            disabled={busyItemId === selectedItem.id}
                            className="w-full rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_26px_rgba(91,71,255,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busyItemId === selectedItem.id
                              ? "购买中..."
                              : "购买素材"}
                          </button>
                        ) : (
                          <div className="w-full rounded-xl border border-white/10 bg-black/18 px-3 py-2 text-center text-xs text-white/42">
                            当前状态暂不可购买
                          </div>
                        )}
                      </div>
                    </div>
                  </aside>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function MarketPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-black text-white">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-400/30 border-t-purple-300" />
        </div>
      }
    >
      <MarketPageContent />
    </Suspense>
  );
}
