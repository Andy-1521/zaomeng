'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image, { type ImageLoaderProps, type ImageProps } from 'next/image';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { showToast } from '@/lib/toast';
import { toUserFacingErrorFromUnknown, toUserFacingErrorMessage } from '@/lib/userFacingError';

interface GenerationRecord {
  id: string;
  userId: string;
  username: string;
  userAvatar: string;
  toolPage: string; // 彩绘提取
  description: string;
  points: number; // 预估积分
  actualPoints: number; // 实际扣除积分
  remainingPoints: number;
  status: string; // 成功、失败、处理中
  prompt: string;
  requestParams: RequestParamsValue;
  resultData: ResultDataValue;
  psdUrl?: string; // PSD文件下载链接
  createdAt: string;
  orderNumber: string;
  uploadedImage?: string;
}

interface UserInfo {
  id: string;
  username: string;
  email: string;
  avatar: string;
  points: number;
  isAdmin: boolean;
  createdAt: string;
}

type TabType = 'generations' | 'users';

type RequestParamsValue = Record<string, unknown> | null;

type SmartEditAgentInfo = {
  userInstruction: string;
  summary: string;
  finalPrompt: string;
  agentPrompt: string;
  negativePrompt: string;
  promptSource: string;
  agentName: string;
  agentModel: string;
  editModel: string;
  editTarget: string;
  editBaseUrl: string;
  usedFallback: boolean;
  requestedAspectRatio: string;
  resolvedAspectRatio: string;
  mode: string;
  regionCount: number | null;
};

function getBooleanParam(params: RequestParamsValue, key: string): boolean {
  return params?.[key] === true;
}

type ResultDataObject = {
  result_image_url?: string | string[];
  error?: string;
  message?: string;
  debug?: {
    error?: string;
  };
  [key: string]: unknown;
};

type ResultDataValue = string | string[] | ResultDataObject | null;

type EditModalValue = string | number | null;

type EditModalState = {
  open: boolean;
  type: 'points' | 'avatar' | null;
  userId: string;
  currentData: EditModalValue;
};

type RecordFilters = {
  keyword: string;
  toolPage: string;
  status: string;
  diagnostic: string;
  startDate: string;
  endDate: string;
};

type StatsState = {
  total: number;
  colorExtractionCount: number;
  successCount: number;
  failureCount: number;
  processingCount: number;
  failureBreakdown: {
    upstreamErrorCount: number;
    timeoutErrorCount: number;
    missingResultCount: number;
    otherFailureCount: number;
  };
};

type ToolOption = {
  label: string;
  value: string;
};

type DiagnosticKey = 'healthy' | 'upstream-error' | 'timeout-error' | 'missing-result' | 'other-failure';

type RecordDiagnostic = {
  key: DiagnosticKey;
  label: string;
  summary: string;
  errorMessage: string;
  resultImageCount: number;
  requestImageCount: number;
  badgeClass: string;
  panelClass: string;
  textClass: string;
};

type DiagnosticRecommendation = {
  title: string;
  detail: string;
};

type DiagnosticOption = {
  label: string;
  value: string;
  description: string;
};

type FilterDropdownOption = {
  label: string;
  value: string;
  description?: string;
};

type AdminDropdownId = 'tool-page' | 'status' | 'diagnostic' | 'time-range';

const adminToolOptions: ToolOption[] = [
  { label: '彩绘提取', value: '彩绘提取' },
  { label: 'AI生图', value: 'AI生图' },
  { label: '智能改图', value: '智能改图' },
  { label: 'AI扩图', value: '去除水印' },
  { label: '高清+扩图', value: '高清+扩图' },
  { label: '高清放大', value: '高清放大' },
];

const diagnosticOptions: DiagnosticOption[] = [
  { label: '无结果', value: 'missing-result', description: '成功或处理中但没有有效结果图' },
  { label: '上游失败', value: 'upstream-error', description: '上游服务明确返回失败' },
  { label: '超时异常', value: 'timeout-error', description: '请求超时或连接中断' },
  { label: '其他异常', value: 'other-failure', description: '未归类的失败订单' },
  { label: '有参考图', value: 'has-reference', description: '带输入图的订单' },
  { label: '已有PSD', value: 'has-psd', description: '已生成 PSD 的订单' },
];

const adminToolFilterOptions: FilterDropdownOption[] = [
  { label: '全部工具', value: '' },
  ...adminToolOptions,
];

const statusFilterOptions: FilterDropdownOption[] = [
  { label: '全部状态', value: '' },
  { label: '成功', value: '成功' },
  { label: '失败', value: '失败' },
  { label: '处理中', value: '处理中' },
];

const diagnosticFilterOptions: FilterDropdownOption[] = [
  { label: '全部诊断', value: '', description: '显示所有异常和正常订单' },
  ...diagnosticOptions,
];

const timeRangeFilterOptions: FilterDropdownOption[] = [
  { label: '全部时间', value: '' },
  { label: '今天', value: 'today' },
  { label: '昨天', value: 'yesterday' },
  { label: '最近7天', value: 'last7days' },
  { label: '最近30天', value: 'last30days' },
  { label: '自定义', value: 'custom' },
];

function getNormalizedToolLabel(toolPage: string, description: string, orderNumber: string): string {
  if (toolPage === 'AI生图' || toolPage === 'AI生图（图生图）' || description.includes('AI生图') || orderNumber.startsWith('AIG')) {
    return 'AI生图';
  }

  if (toolPage === '彩绘提取' || toolPage === '彩绘提取2' || description.includes('彩绘提取')) {
    return '彩绘提取';
  }

  if (toolPage === '智能改图' || toolPage === '局部改图' || description.includes('智能改图') || description.includes('局部改图') || orderNumber.startsWith('LCL-')) {
    return '智能改图';
  }

  if (toolPage === '高清+扩图' || description.includes('高清+扩图') || orderNumber.startsWith('HDO-')) {
    return '高清+扩图';
  }

  if (toolPage === 'AI扩图' || toolPage === '去除水印' || toolPage === '去水印' || description.includes('去除水印') || description.includes('AI扩图') || orderNumber.startsWith('RW-')) {
    return 'AI扩图';
  }

  if (toolPage === '高清放大' || description.includes('高清放大') || orderNumber.startsWith('HD-')) {
    return '高清放大';
  }

  return toolPage || '其他工具';
}

function getToolBadgeClass(toolLabel: string): string {
  if (toolLabel === '彩绘提取') return 'border-violet-300/25 bg-violet-500/15 text-violet-100';
  if (toolLabel === 'AI生图') return 'border-fuchsia-300/25 bg-fuchsia-500/15 text-fuchsia-100';
  if (toolLabel === '智能改图') return 'border-sky-300/25 bg-sky-500/15 text-sky-100';
  if (toolLabel === 'AI扩图') return 'border-teal-300/25 bg-teal-500/15 text-teal-100';
  if (toolLabel === '高清+扩图') return 'border-cyan-300/25 bg-cyan-500/15 text-cyan-100';
  if (toolLabel === '高清放大') return 'border-amber-300/25 bg-amber-500/15 text-amber-100';
  return 'border-white/15 bg-white/10 text-white/72';
}

function getStringParam(params: RequestParamsValue, key: string): string {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
}

function getNumberParam(params: RequestParamsValue, key: string): number | null {
  const value = params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getSmartEditAgentInfo(record: GenerationRecord | null): SmartEditAgentInfo | null {
  if (!record) return null;

  const toolLabel = getNormalizedToolLabel(record.toolPage, record.description || '', record.orderNumber || '');
  if (toolLabel !== '智能改图') return null;

  const params = record.requestParams;
  return {
    userInstruction: getStringParam(params, 'userInstruction'),
    summary: getStringParam(params, 'summary') || getStringParam(params, 'promptSummary'),
    finalPrompt: getStringParam(params, 'finalPrompt') || record.prompt || '',
    agentPrompt: getStringParam(params, 'agentPrompt'),
    negativePrompt: getStringParam(params, 'negativePrompt'),
    promptSource: getStringParam(params, 'promptSource'),
    agentName: getStringParam(params, 'agentName'),
    agentModel: getStringParam(params, 'agentModel'),
    editModel: getStringParam(params, 'editModel'),
    editTarget: getStringParam(params, 'editTarget'),
    editBaseUrl: getStringParam(params, 'editBaseUrl'),
    usedFallback: getBooleanParam(params, 'usedFallback'),
    requestedAspectRatio: getStringParam(params, 'requestedAspectRatio') || getStringParam(params, 'requestedSize'),
    resolvedAspectRatio: getStringParam(params, 'resolvedAspectRatio') || getStringParam(params, 'resolvedSize'),
    mode: getStringParam(params, 'mode'),
    regionCount: getNumberParam(params, 'regionCount'),
  };
}

function getRequestImageUrls(params: RequestParamsValue, fallbackUploadedImage?: string): string[] {
  const urls: string[] = [];
  const pushIfValid = (value: unknown) => {
    if (typeof value === 'string' && value) {
      urls.push(value);
    }
  };

  if (params) {
    const candidates = [
      params.uploadedImage,
      params.uploaded_image,
      params.originalImageUrl,
      params.imageUrl,
    ];
    candidates.forEach(pushIfValid);

    if (Array.isArray(params.urls)) {
      params.urls.forEach(pushIfValid);
    }
  }

  pushIfValid(fallbackUploadedImage);
  return Array.from(new Set(urls));
}

function getResultImageUrls(data: ResultDataValue): string[] {
  if (!data) return [];
  if (typeof data === 'string') return [data];
  if (Array.isArray(data)) return data.filter((item): item is string => typeof item === 'string');
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data.result_image_url)) {
      return data.result_image_url.filter((item): item is string => typeof item === 'string');
    }
    if (typeof data.result_image_url === 'string') {
      return [data.result_image_url];
    }
  }
  return [];
}

function getRawResultErrorMessage(data: ResultDataValue): string {
  if (!data) return '未知错误';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.join(', ') || '未知错误';

  return data.error || data.message || data.debug?.error || '未知错误';
}

function getResultErrorMessage(data: ResultDataValue): string {
  const rawMessage = getRawResultErrorMessage(data);

  return toUserFacingErrorMessage(rawMessage, '暂时未能完成处理，请稍后重试');
}

function getRecordDiagnostic(record: Pick<GenerationRecord, 'status' | 'resultData' | 'requestParams' | 'uploadedImage'>): RecordDiagnostic {
  const resultImageCount = getResultImageUrls(record.resultData).length;
  const requestImageCount = getRequestImageUrls(record.requestParams, record.uploadedImage).length;
  const errorMessage = getRawResultErrorMessage(record.resultData);
  const hasTimeoutError = /ETIMEDOUT|timeout|超时/i.test(errorMessage);
  const hasUpstreamError = /upstream_error|Upstream request failed/i.test(errorMessage);

  if (record.status === '失败' && hasUpstreamError) {
    return {
      key: 'upstream-error',
      label: '上游失败',
      summary: `上游兼容接口返回失败，当前订单未拿到可用结果。${requestImageCount > 0 ? `该单带 ${requestImageCount} 张参考图，可优先复查上游图像编辑链路。` : '该单没有可识别的参考图信息。'}`,
      errorMessage,
      resultImageCount,
      requestImageCount,
      badgeClass: 'border-red-400/20 bg-red-500/10 text-red-100',
      panelClass: 'border-red-500/20 bg-red-500/10',
      textClass: 'text-red-100',
    };
  }

  if (record.status === '失败' && hasTimeoutError) {
    return {
      key: 'timeout-error',
      label: '超时异常',
      summary: `请求在上游或网络链路中超时中断。${requestImageCount > 0 ? `该单带 ${requestImageCount} 张参考图，建议优先检查图片大小、上游处理时长和重试策略。` : '建议优先检查网络稳定性和上游处理时长。'}`,
      errorMessage,
      resultImageCount,
      requestImageCount,
      badgeClass: 'border-orange-400/20 bg-orange-500/10 text-orange-100',
      panelClass: 'border-orange-500/20 bg-orange-500/10',
      textClass: 'text-orange-100',
    };
  }

  if (record.status === '失败') {
    return {
      key: 'other-failure',
      label: '其他异常',
      summary: `订单已失败，但不属于上游失败或超时异常。${errorMessage && errorMessage !== '未知错误' ? ' 需要结合原始结果数据继续人工排查。' : ' 当前错误信息不完整，建议重点查看原始请求与结果数据。'}`,
      errorMessage,
      resultImageCount,
      requestImageCount,
      badgeClass: 'border-white/20 bg-white/10 text-white',
      panelClass: 'border-white/15 bg-white/[0.05]',
      textClass: 'text-white/85',
    };
  }

  if (resultImageCount === 0) {
    return {
      key: 'missing-result',
      label: '无结果',
      summary: `${record.status === '处理中' ? '订单仍在处理中，但当前还没有有效结果图。' : '订单状态不是失败，但没有发现有效结果图。'}${requestImageCount > 0 ? ` 该单带 ${requestImageCount} 张参考图，建议对照任务状态和回调入库链路核查。` : ' 建议检查任务状态回写和结果入库链路。'}`,
      errorMessage,
      resultImageCount,
      requestImageCount,
      badgeClass: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
      panelClass: 'border-amber-500/20 bg-amber-500/10',
      textClass: 'text-amber-100',
    };
  }

  return {
    key: 'healthy',
    label: '结果正常',
    summary: `当前订单已产出 ${resultImageCount} 张结果图${requestImageCount > 0 ? `，并携带 ${requestImageCount} 张参考图` : ''}，未检测到明显异常。`,
    errorMessage,
    resultImageCount,
    requestImageCount,
    badgeClass: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
    panelClass: 'border-emerald-500/20 bg-emerald-500/10',
    textClass: 'text-emerald-100',
  };
}

function getDiagnosticRecommendations(
  record: Pick<GenerationRecord, 'toolPage' | 'status' | 'requestParams' | 'uploadedImage'>,
  diagnostic: RecordDiagnostic
): DiagnosticRecommendation[] {
  const requestImageCount = getRequestImageUrls(record.requestParams, record.uploadedImage).length;

  if (diagnostic.key === 'upstream-error') {
    return [
      {
        title: '复核上游图像编辑链路',
        detail: '优先检查 OpenAI 兼容 images/edits 接口是否在同时间段返回 502、upstream_error 或网关错误。',
      },
      {
        title: '重放同类请求',
        detail: `${requestImageCount > 0 ? `该单带 ${requestImageCount} 张参考图，` : ''}建议用同一张输入图、遮罩和工具参数做一次最小复现，确认是否为稳定可复现的上游故障。`,
      },
      {
        title: '对比同工具近期失败单',
        detail: `查看同一工具 ${record.toolPage || '当前工具'} 在相近时间是否集中失败，快速判断是局部单据问题还是系统性故障。`,
      },
    ];
  }

  if (diagnostic.key === 'timeout-error') {
    return [
      {
        title: '检查超时点位',
        detail: '先确认是应用侧等待超时、网络中断，还是上游处理时间过长导致的连接超时。',
      },
      {
        title: '核对输入尺寸与复杂度',
        detail: `${requestImageCount > 0 ? `该单带 ${requestImageCount} 张参考图，` : ''}优先检查原图尺寸、参考图数量、遮罩范围和任务复杂度，排除单次请求过重。`,
      },
      {
        title: '复查重试策略',
        detail: '确认当前工具是否需要增加重试、缩短单次处理链路，或在超时后补偿回写失败状态。',
      },
    ];
  }

  if (diagnostic.key === 'missing-result') {
    return [
      {
        title: '检查结果入库链路',
        detail: '重点核对任务执行成功后，结果 URL 是否正确写回 transaction.resultData。',
      },
      {
        title: '检查存储上传结果',
        detail: '确认结果图是否已经生成但上传存储失败，或返回结构变化导致前端没有识别出 imageUrl/result_image_url。',
      },
      {
        title: '核对任务真实状态',
        detail: `当前订单状态为 ${record.status}，建议对照任务回调、轮询或异步工作流日志，看是否存在状态已更新但结果未同步的情况。`,
      },
    ];
  }

  if (diagnostic.key === 'other-failure') {
    return [
      {
        title: '先看原始请求与结果数据',
        detail: '这类订单没有命中已知的上游失败或超时特征，优先查看下方原始请求参数和结果数据。',
      },
      {
        title: '按工具维度对比',
        detail: `对比同一工具 ${record.toolPage || '当前工具'} 的成功单和失败单，排查是否是参数格式、输入图类型或流程分支差异导致。`,
      },
      {
        title: '必要时做单单复现',
        detail: '如果错误信息不完整，建议在测试环境或日志中重放该订单，补齐更明确的异常来源。',
      },
    ];
  }

  return [
    {
      title: '结果已正常产出',
      detail: '当前订单没有明显异常。如果用户仍反馈问题，优先人工核对结果图质量与业务预期是否一致。',
    },
    {
      title: '必要时检查输入输出一致性',
      detail: `${requestImageCount > 0 ? `该单带 ${requestImageCount} 张参考图，` : ''}可继续核对参考图、描述和最终结果是否匹配。`,
    },
  ];
}

const passthroughImageLoader = ({ src }: ImageLoaderProps) => src;

function SafeImage({ alt, ...props }: Omit<ImageProps, 'loader'>) {
  return <Image {...props} alt={alt} loader={passthroughImageLoader} unoptimized />;
}

type AdminFilterDropdownProps = {
  dropdownId: AdminDropdownId;
  value: string;
  options: FilterDropdownOption[];
  isOpen: boolean;
  onToggle: (dropdownId: AdminDropdownId) => void;
  onSelect: (value: string) => void;
  align?: 'left' | 'right';
  menuWidthClassName?: string;
};

function AdminFilterDropdown({
  dropdownId,
  value,
  options,
  isOpen,
  onToggle,
  onSelect,
  align = 'left',
  menuWidthClassName = 'min-w-[148px]',
}: AdminFilterDropdownProps) {
  const selectedOption = options.find((option) => option.value === value) || options[0];
  const positionClassName = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div className="relative w-full sm:w-auto" data-role="admin-filter-dropdown">
      <button
        type="button"
        onClick={() => onToggle(dropdownId)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/40 px-4 py-2.5 text-sm text-white transition-colors hover:border-purple-500/45 hover:bg-black/55 focus:outline-none focus:border-purple-500 sm:min-w-[136px]"
      >
        <span className={`truncate ${value ? 'text-white' : 'text-white/70'}`}>{selectedOption?.label || '请选择'}</span>
        <span className={`text-[10px] text-white/45 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {isOpen ? (
        <div className={`absolute ${positionClassName} top-full z-30 mt-2 max-w-[calc(100vw-2rem)] ${menuWidthClassName} overflow-hidden rounded-2xl border border-white/12 bg-[#0d0d12] p-1 shadow-[0_18px_40px_rgba(0,0,0,0.4)]`}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={`${dropdownId}-${option.value || 'all'}`}
                type="button"
                onClick={() => onSelect(option.value)}
                title={option.description || option.label}
                className={`flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${selected ? 'bg-white text-slate-950' : 'text-white/72 hover:bg-white/[0.08] hover:text-white'}`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.description ? (
                    <span className={`mt-0.5 text-[11px] leading-4 ${selected ? 'text-slate-600' : 'text-white/42'}`}>
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {selected ? <span className="pt-0.5 text-[10px]">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminGenerationsPage() {
  const router = useRouter();
  const initialLocalAdmin = (() => {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) return null;
      const parsed = JSON.parse(userStr) as { id?: string; isAdmin?: boolean };
      return parsed.isAdmin ? parsed : null;
    } catch {
      return null;
    }
  })();
  const [activeTab, setActiveTab] = useState<TabType>('generations');
  const [records, setRecords] = useState<GenerationRecord[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(!initialLocalAdmin);
  const [error, setError] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [currentAdminId, setCurrentAdminId] = useState<string | null>(initialLocalAdmin?.id || null);
  const [sessionRefreshed, setSessionRefreshed] = useState(!!initialLocalAdmin);

  // 详情模态框状态
  const [detailModal, setDetailModal] = useState<{ open: boolean; record: GenerationRecord | null }>({
    open: false,
    record: null,
  });

  // 搜索和筛选参数
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterToolPage, setFilterToolPage] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDiagnostic, setFilterDiagnostic] = useState('');
  const [filterTimeRange, setFilterTimeRange] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState<AdminDropdownId | null>(null);

  // 统计数据
  const [totalStats, setTotalStats] = useState<StatsState>({
    total: 0,
    colorExtractionCount: 0,
    successCount: 0,
    failureCount: 0,
    processingCount: 0,
    failureBreakdown: {
      upstreamErrorCount: 0,
      timeoutErrorCount: 0,
      missingResultCount: 0,
      otherFailureCount: 0,
    },
  });

  // 全局统计（不受筛选影响，首次加载时固定）
  const [globalStats, setGlobalStats] = useState({
    total: 0,
  });

  // 用户搜索参数
  const [userSearchKeyword, setUserSearchKeyword] = useState('');

  const [editModal, setEditModal] = useState<EditModalState>({
    open: false,
    type: null,
    userId: '',
    currentData: null,
  });
  const [editValue, setEditValue] = useState('');

  // 计算派生统计
  const successRate = totalStats.total > 0
    ? Math.round((totalStats.successCount / totalStats.total) * 100)
    : 0;
  const totalPointsConsumed = records.reduce((sum, r) => sum + (r.actualPoints > 0 ? r.actualPoints : 0), 0);
  const processingCount = totalStats.processingCount || records.filter((record) => record.status === '处理中' || record.status === 'pending').length;

  const derivedToolStats = records.reduce<Record<string, number>>((acc, record) => {
    const toolLabel = getNormalizedToolLabel(record.toolPage, record.description || '', record.orderNumber || '');
    acc[toolLabel] = (acc[toolLabel] || 0) + 1;
    return acc;
  }, {});

  const activeToolSummary = adminToolOptions
    .map((option) => ({ ...option, count: derivedToolStats[option.label] || 0 }))
    .filter((option) => option.count > 0 || option.value === filterToolPage);

  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const hasRecordsRef = useRef(false);

  const toggleDropdown = useCallback((dropdownId: AdminDropdownId) => {
    setOpenDropdownId((current) => current === dropdownId ? null : dropdownId);
  }, []);

  const closeDropdowns = useCallback(() => {
    setOpenDropdownId(null);
  }, []);

  useEffect(() => {
    hasRecordsRef.current = records.length > 0;
  }, [records]);

  const loadRecords = useCallback(async (pageNum: number = 0, filters?: Partial<RecordFilters>) => {
    if (!hasRecordsRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const userId = currentAdminId || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).id : '');

      const params = new URLSearchParams({
        skip: (pageNum * 50).toString(),
        limit: '50',
        userId,
      });

      const keyword = filters?.keyword !== undefined ? filters.keyword : searchKeyword;
      const toolPage = filters?.toolPage !== undefined ? filters.toolPage : filterToolPage;
      const status = filters?.status !== undefined ? filters.status : filterStatus;
      const diagnostic = filters?.diagnostic !== undefined ? filters.diagnostic : filterDiagnostic;
      const startDate = filters?.startDate !== undefined ? filters.startDate : filterStartDate;
      const endDate = filters?.endDate !== undefined ? filters.endDate : filterEndDate;

      if (keyword) params.append('keyword', keyword);
      if (toolPage) params.append('toolPage', toolPage);
      if (status) params.append('status', status);
      if (diagnostic) params.append('diagnostic', diagnostic);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/admin/generations?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        if (pageNum === 0) {
          setRecords(data.data.records);
          const newStats = {
            total: data.data.total || 0,
            colorExtractionCount: data.data.stats?.colorExtractionCount || 0,
            successCount: data.data.stats?.successCount || 0,
            failureCount: data.data.stats?.failureCount || 0,
            processingCount: data.data.stats?.processingCount || 0,
            failureBreakdown: {
              upstreamErrorCount: data.data.stats?.failureBreakdown?.upstreamErrorCount || 0,
              timeoutErrorCount: data.data.stats?.failureBreakdown?.timeoutErrorCount || 0,
              missingResultCount: data.data.stats?.failureBreakdown?.missingResultCount || 0,
              otherFailureCount: data.data.stats?.failureBreakdown?.otherFailureCount || 0,
            },
          };
          setTotalStats(newStats);
          // 无筛选条件时缓存全局统计
          const hasFilter = keyword || toolPage || status || diagnostic || startDate || endDate;
          if (!hasFilter) {
            setGlobalStats({ total: newStats.total });
          }
        } else {
          // 按 id 去重，避免筛选条件下分页数据重叠导致 key 重复
          setRecords(prev => {
            const existingIds = new Set(prev.map(r => r.id));
            const newRecords = data.data.records.filter((r: { id: string }) => !existingIds.has(r.id));
            return [...prev, ...newRecords];
          });
        }
        setHasMore(data.data.records.length >= 50);
      } else {
        setError(data.message || '加载失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [currentAdminId, filterDiagnostic, filterEndDate, filterStartDate, filterStatus, filterToolPage, searchKeyword]);

  const getCurrentFilters = useCallback((overrides?: Partial<RecordFilters>): RecordFilters => {
    return {
      keyword: overrides?.keyword ?? searchKeyword,
      toolPage: overrides?.toolPage ?? filterToolPage,
      status: overrides?.status ?? filterStatus,
      diagnostic: overrides?.diagnostic ?? filterDiagnostic,
      startDate: overrides?.startDate ?? filterStartDate,
      endDate: overrides?.endDate ?? filterEndDate,
    };
  }, [filterDiagnostic, filterEndDate, filterStartDate, filterStatus, filterToolPage, searchKeyword]);

  const triggerRecordSearch = useCallback((overrides?: Partial<RecordFilters>) => {
    const filters = getCurrentFilters(overrides);
    setPage(0);
    void loadRecords(0, filters);
  }, [getCurrentFilters, loadRecords]);

  const extractImageUrl = (data: ResultDataValue): string | null => {
    return getResultImageUrls(data)[0] || null;
  };

  const getImageCount = (data: ResultDataValue): number => {
    return getResultImageUrls(data).length;
  };

  const loadUsers = useCallback(async (keyword?: string) => {
    setLoading(true);
    setError(null);

    try {
      const userId = currentAdminId || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).id : '');
      const params = new URLSearchParams({ userId });
      if (keyword) {
        params.append('keyword', keyword);
      }

      const response = await fetch(`/api/user/users?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        setUsers(data.data);
      } else {
        setError(data.message || '加载失败');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [currentAdminId]);

  const handleToolPageChange = (value: string) => {
    closeDropdowns();
    setFilterToolPage(value);
    triggerRecordSearch({ toolPage: value });
  };

  const handleStatusChange = (value: string) => {
    closeDropdowns();
    setFilterStatus(value);
    triggerRecordSearch({ status: value });
  };

  const handleDiagnosticChange = (value: string) => {
    closeDropdowns();
    setFilterDiagnostic(value);
    triggerRecordSearch({ diagnostic: value });
  };

  const handleDiagnosticShortcut = (diagnosticKey: DiagnosticKey) => {
    closeDropdowns();
    if (diagnosticKey === 'healthy') {
      setFilterDiagnostic('');
      triggerRecordSearch({ diagnostic: '' });
      return;
    }

    const nextStatus = diagnosticKey === 'missing-result' ? '' : '失败';
    setFilterStatus(nextStatus);
    setFilterDiagnostic(diagnosticKey);
    triggerRecordSearch({ status: nextStatus, diagnostic: diagnosticKey });
  };

  const handleTimeRangeChange = (value: string) => {
    closeDropdowns();
    const now = new Date();
    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    let startDate = '';
    let endDate = '';

    switch (value) {
      case 'today':
        startDate = formatDate(now);
        endDate = startDate;
        break;
      case 'yesterday': {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        startDate = formatDate(yesterday);
        endDate = startDate;
        break;
      }
      case 'last7days': {
        const last7Days = new Date(now);
        last7Days.setDate(last7Days.getDate() - 6);
        startDate = formatDate(last7Days);
        endDate = formatDate(now);
        break;
      }
      case 'last30days': {
        const last30Days = new Date(now);
        last30Days.setDate(last30Days.getDate() - 29);
        startDate = formatDate(last30Days);
        endDate = formatDate(now);
        break;
      }
      case 'custom':
        startDate = filterStartDate;
        endDate = filterEndDate;
        break;
      default:
        break;
    }

    setFilterTimeRange(value);
    setFilterStartDate(startDate);
    setFilterEndDate(endDate);

    if (value !== 'custom') {
      triggerRecordSearch({ startDate, endDate });
    }
  };

  const refreshSession = useCallback(async () => {
    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) {
        showToast('登录状态已失效，请重新登录', 'error');
        router.push('/login');
        return;
      }

      const user = JSON.parse(userStr);

      if (user?.id) {
        setCurrentAdminId(user.id);
      }

      if (user?.isAdmin) {
        setSessionRefreshed(true);
      }

      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await response.json();

      if (data.success) {
        localStorage.setItem('user', JSON.stringify(data.data));
        setCurrentAdminId(data.data.id);
        setSessionRefreshed(true);

        if (!data.data.isAdmin) {
          showToast('当前账号暂无管理员权限', 'error');
          router.push('/home');
          return;
        }
      } else {
        if (response.status === 401) {
          if (user?.isAdmin) {
            console.warn('[Admin] refresh 返回 401，继续使用本地管理员状态');
            return;
          }

          showToast('登录状态已失效，请重新登录', 'error');
          router.push('/login');
          return;
        }

        showToast(toUserFacingErrorMessage(data.message, '管理员权限校验失败'), 'error');
        if (!user?.isAdmin) {
          router.push('/home');
        }
      }
    } catch (error) {
      console.error('[Admin] 刷新管理员会话失败:', error);
      const userStr = localStorage.getItem('user');
      const localUser = userStr ? JSON.parse(userStr) : null;
      if (localUser?.isAdmin) {
        console.warn('[Admin] refresh 异常，继续使用本地管理员状态');
        setCurrentAdminId(localUser.id);
        setSessionRefreshed(true);
        return;
      }

      showToast('管理员会话校验失败，请稍后重试', 'error');
      router.push('/home');
    }
  }, [router]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshSession();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshSession]);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-role="admin-filter-dropdown"]')) return;
      closeDropdowns();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDropdowns();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDropdowns]);

  useEffect(() => {
    if (sessionRefreshed && currentAdminId) {
      const timeoutId = window.setTimeout(() => {
        if (activeTab === 'generations') {
          void loadRecords(0);
        } else {
          void loadUsers();
        }
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }
  }, [activeTab, sessionRefreshed, currentAdminId, loadRecords, loadUsers]);

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean, username: string) => {
    const action = currentIsAdmin ? '取消' : '设置';
    if (!confirm(`确定要${action}用户 "${username}" 为管理员吗？`)) {
      return;
    }

    try {
      const response = await fetch('/api/admin/set-admin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: userId,
          isAdmin: !currentIsAdmin,
        }),
      });

      const data = await response.json();
      if (data.success) {
        loadUsers();
        showToast(data.message || '操作成功', 'success');
      } else {
        showToast(toUserFacingErrorMessage(data.message, '操作失败，请稍后重试'), 'error');
      }
    } catch {
      showToast('操作失败，请稍后重试', 'error');
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadRecords(nextPage);
  };

  const handleResetFilters = () => {
    closeDropdowns();
    setSearchKeyword('');
    setFilterToolPage('');
    setFilterStatus('');
    setFilterDiagnostic('');
    setFilterTimeRange('');
    setFilterStartDate('');
    setFilterEndDate('');
    setPage(0);
    triggerRecordSearch({
      keyword: '',
      toolPage: '',
      status: '',
      diagnostic: '',
      startDate: '',
      endDate: ''
    });
  };

  // 快速筛选：点击统计卡片自动筛选
  const handleQuickFilter = (toolPage?: string, nextStatus?: string, nextDiagnostic?: string) => {
    closeDropdowns();
    const newToolPage = toolPage !== undefined ? ((toolPage === filterToolPage) ? '' : toolPage) : filterToolPage;
    const newStatus = nextStatus !== undefined ? ((nextStatus === filterStatus) ? '' : nextStatus) : filterStatus;
    const newDiagnostic = nextDiagnostic !== undefined ? ((nextDiagnostic === filterDiagnostic) ? '' : nextDiagnostic) : filterDiagnostic;
    setFilterToolPage(newToolPage);
    setFilterStatus(newStatus);
    setFilterDiagnostic(newDiagnostic);
    setPage(0);
    triggerRecordSearch({
      keyword: searchKeyword,
      toolPage: newToolPage,
      status: newStatus,
      diagnostic: newDiagnostic,
      startDate: filterStartDate,
      endDate: filterEndDate
    });
  };

  // 防抖搜索：输入时自动搜索
  const handleSearchInput = (value: string) => {
    setSearchKeyword(value);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      triggerRecordSearch({
        keyword: value,
        toolPage: filterToolPage,
        status: filterStatus,
        diagnostic: filterDiagnostic,
        startDate: filterStartDate,
        endDate: filterEndDate
      });
    }, 300);
  };

  // 获取状态标签
  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { dotClass: string; labelClass: string }> = {
      '成功': { dotClass: 'bg-green-500', labelClass: 'text-green-600' },
      '失败': { dotClass: 'bg-red-500', labelClass: 'text-red-600' },
      '处理中': { dotClass: 'bg-amber-500', labelClass: 'text-amber-600' },
    };
    const config = statusConfig[status];
    if (!config) return <span className="text-white/60">{status}</span>;

    return (
      <div className="inline-flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${config.dotClass} ${status === '处理中' ? 'animate-pulse' : ''}`} />
        <span className={`text-sm font-medium ${config.labelClass}`}>{status}</span>
      </div>
    );
  };

  const renderToolBadge = (record: GenerationRecord) => {
    const toolLabel = getNormalizedToolLabel(record.toolPage, record.description || '', record.orderNumber || '');
    return (
      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getToolBadgeClass(toolLabel)}`}>
        {toolLabel}
      </span>
    );
  };

  const openEditModal = (userId: string, type: 'points' | 'avatar', currentValue: EditModalValue) => {
    setEditModal({
      open: true,
      type,
      userId,
      currentData: currentValue,
    });
    if (type === 'points') {
      setEditValue(typeof currentValue === 'number' ? currentValue.toString() : '');
      return;
    }

    setEditValue(typeof currentValue === 'string' ? currentValue : '');
  };

  const closeEditModal = () => {
    setEditModal({
      open: false,
      type: null,
      userId: '',
      currentData: null,
    });
    setEditValue('');
  };

  const handleSaveEdit = async () => {
    const { userId, type } = editModal;
    if (!userId || !type) return;

    try {
      const updateData: { points?: number; avatar?: string } = {};

      if (type === 'points') {
        const points = parseInt(editValue);
        if (isNaN(points) || points < 0) {
          showToast('请输入有效的积分数值', 'error');
          return;
        }
        updateData.points = points;
      } else if (type === 'avatar') {
        updateData.avatar = editValue.trim();
      }

      const adminUserId = currentAdminId || (localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')!).id : '');
      const response = await fetch(`/api/admin/update-user?userId=${adminUserId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...updateData,
        }),
      });

      const data = await response.json();
      if (data.success) {
        showToast('更新成功', 'success');
        void loadUsers();
        closeEditModal();
      } else {
        showToast(toUserFacingErrorMessage(data.message, '更新失败，请稍后重试'), 'error');
      }
    } catch {
      showToast('操作失败，请稍后重试', 'error');
    }
  };

  // 格式化时间（更简洁）
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `今天 ${time}`;
    if (isYesterday) return `昨天 ${time}`;
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' + time;
  };

  const detailRecord = detailModal.record;
  const detailResultImages = detailRecord ? getResultImageUrls(detailRecord.resultData) : [];
  const detailRequestImages = detailRecord ? getRequestImageUrls(detailRecord.requestParams, detailRecord.uploadedImage) : [];
  const detailDiagnostic = detailRecord ? getRecordDiagnostic(detailRecord) : null;
  const detailSmartEditAgent = getSmartEditAgentInfo(detailRecord);
  const detailRecommendations = detailRecord && detailDiagnostic
    ? getDiagnosticRecommendations(detailRecord, detailDiagnostic)
    : [];

  if (loading && (activeTab === 'generations' ? records.length === 0 : users.length === 0)) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-900 to-black" />
          <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-purple-600/12 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[700px] h-[700px] bg-blue-600/12 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        </div>
        <div className="relative z-10 text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-white/20 border-t-white mx-auto mb-4" />
          <p className="text-white/60">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-screen bg-black text-white relative overflow-hidden flex flex-col">
        {/* 动态背景 */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-black via-neutral-900 to-black" />
          <div className="absolute top-1/4 left-1/4 w-[800px] h-[800px] bg-purple-600/12 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-[700px] h-[700px] bg-blue-600/12 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1.5s' }} />
        </div>

        <Navbar showUserMenu={false} />

        <div className="relative z-10 flex flex-col flex-1 min-h-0 px-6 py-4">
        <div className="max-w-7xl mx-auto w-full flex flex-col flex-1 min-h-0">
          {/* Page header */}
          <div className="mb-4 flex-shrink-0">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              管理员后台
            </h1>
          </div>

          {/* Tab switcher */}
          <div className="flex mb-4 bg-white/10 rounded-lg p-1 border border-white/20 flex-shrink-0">
            {[
              { key: 'generations' as TabType, label: '生图记录' },
              { key: 'users' as TabType, label: '用户管理' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  closeDropdowns();
                  setActiveTab(tab.key);
                  setPage(0);
                }}
                className={`flex-1 py-2.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/30'
                    : 'text-white/40 hover:text-white/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-6">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {/* ===== Users Tab ===== */}
          {activeTab === 'users' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              {/* User search */}
              <div className="flex gap-3 flex-shrink-0">
                <div className="flex-1 max-w-md">
                  <input
                    type="text"
                    value={userSearchKeyword}
                    onChange={(e) => setUserSearchKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadUsers(userSearchKeyword)}
                    placeholder="搜索用户名或邮箱..."
                    className="w-full bg-black/50 border border-white/20 rounded-lg px-4 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-purple-500 transition-colors"
                  />
                </div>
                <button
                  onClick={() => loadUsers(userSearchKeyword)}
                  className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  搜索
                </button>
                <button
                  onClick={() => {
                    setUserSearchKeyword('');
                    loadUsers('');
                  }}
                  className="px-4 py-2 border border-white/10 rounded-lg text-sm font-medium hover:bg-white/20 transition-colors"
                >
                  重置
                </button>
              </div>

              {users.length === 0 && !loading ? (
                <div className="flex-1 flex items-center justify-center bg-white/5 rounded-xl border border-white/10">
                  <p className="text-white/60">暂无用户</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 bg-white/5 rounded-xl border border-white/10 overflow-y-auto">
                  <table className="w-full">
                    <thead className="sticky top-0 z-[1]">
                      <tr className="border-b border-white/10 bg-neutral-900/95 backdrop-blur">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">用户</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">邮箱</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">积分</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">角色</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user, idx) => (
                        <tr key={user.id} className={`border-b border-white/10 last:border-0 ${idx % 2 === 1 ? 'bg-white/[0.08]' : ''} hover:bg-white/20 transition-colors`}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full group" onClick={() => openEditModal(user.id, 'avatar', user.avatar)}>
                                <SafeImage
                                  src={user.avatar || '/images/avatar.png'}
                                  alt={user.username}
                                  fill
                                  sizes="32px"
                                  className="object-cover"
                                />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                </div>
                              </div>
                              <span className="text-sm font-medium">{user.username}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-sm text-white/60">{user.email}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <SafeImage src="/points-icon.png" alt="积分" width={16} height={16} className="h-4 w-4" />
                              <span className="text-sm font-medium text-amber-600">{user.points}</span>
                              <button
                                onClick={() => openEditModal(user.id, 'points', user.points)}
                                className="text-white/60 hover:text-white text-xs transition-colors"
                                title="修改积分"
                              >
                                ✎
                              </button>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {user.isAdmin ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/10 text-white">管理员</span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/20 text-white/60">普通用户</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            {user.id !== currentAdminId && (
                              <button
                                onClick={() => handleToggleAdmin(user.id, user.isAdmin, user.username)}
                                className="text-sm text-white/60 hover:text-white transition-colors"
                              >
                                {user.isAdmin ? '取消管理员' : '设为管理员'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ===== Generations Tab ===== */}
          {activeTab === 'generations' && (
            <div className="flex-1 min-h-0 flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6 flex-shrink-0">
                <button
                  onClick={handleResetFilters}
                  className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-left transition-colors hover:bg-white/[0.08]"
                >
                  <div className="text-xs text-white/45">总订单</div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums text-white">{globalStats.total || totalStats.total}</div>
                  <div className="mt-2 text-xs text-white/35">点击重置所有筛选</div>
                </button>

                <button
                  onClick={() => handleQuickFilter(undefined, '处理中')}
                  className={`rounded-2xl border p-4 text-left transition-colors ${filterStatus === '处理中' ? 'border-sky-400/40 bg-sky-500/10' : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.08]'}`}
                >
                  <div className="text-xs text-white/45">处理中</div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums text-sky-300">{processingCount}</div>
                  <div className="mt-2 text-xs text-white/35">优先查看积压订单</div>
                </button>

                <button
                  onClick={() => handleQuickFilter(undefined, '失败')}
                  className={`rounded-2xl border p-4 text-left transition-colors ${filterStatus === '失败' ? 'border-red-400/40 bg-red-500/10' : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.08]'}`}
                >
                  <div className="text-xs text-white/45">失败</div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums text-red-300">{totalStats.failureCount}</div>
                  <div className="mt-2 text-xs text-white/35">快速定位异常任务</div>
                </button>

                <button
                  onClick={() => handleQuickFilter(undefined, '成功')}
                  className={`rounded-2xl border p-4 text-left transition-colors ${filterStatus === '成功' ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.08]'}`}
                >
                  <div className="text-xs text-white/45">成功率</div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums text-emerald-300">{successRate}<span className="ml-1 text-base text-emerald-200/70">%</span></div>
                  <div className="mt-2 text-xs text-white/35">成功 {totalStats.successCount} 单</div>
                </button>

                <button
                  onClick={() => handleQuickFilter('彩绘提取')}
                  className={`rounded-2xl border p-4 text-left transition-colors ${filterToolPage === '彩绘提取' ? 'border-violet-400/40 bg-violet-500/10' : 'border-white/10 bg-white/[0.05] hover:bg-white/[0.08]'}`}
                >
                  <div className="text-xs text-white/45">彩绘提取</div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums text-violet-200">{totalStats.colorExtractionCount}</div>
                  <div className="mt-2 text-xs text-white/35">核心工具量级</div>
                </button>

                <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-left">
                  <div className="text-xs text-white/45">本页消耗积分</div>
                  <div className="mt-2 text-3xl font-semibold tabular-nums text-amber-300">{totalPointsConsumed}</div>
                  <div className="mt-2 text-xs text-white/35">当前列表汇总</div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 flex-shrink-0">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="w-full sm:max-w-sm sm:min-w-[220px] sm:flex-1">
                    <input
                      type="text"
                      value={searchKeyword}
                      onChange={(e) => handleSearchInput(e.target.value)}
                      placeholder="搜索用户名、订单号或异常信息..."
                      className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-2.5 text-sm text-white placeholder-white/35 focus:outline-none focus:border-purple-500 transition-colors"
                    />
                  </div>

                  <AdminFilterDropdown
                    dropdownId="tool-page"
                    value={filterToolPage}
                    options={adminToolFilterOptions}
                    isOpen={openDropdownId === 'tool-page'}
                    onToggle={toggleDropdown}
                    onSelect={(value) => {
                      closeDropdowns();
                      handleToolPageChange(value);
                    }}
                  />

                  <AdminFilterDropdown
                    dropdownId="status"
                    value={filterStatus}
                    options={statusFilterOptions}
                    isOpen={openDropdownId === 'status'}
                    onToggle={toggleDropdown}
                    onSelect={(value) => {
                      closeDropdowns();
                      handleStatusChange(value);
                    }}
                  />

                  <AdminFilterDropdown
                    dropdownId="diagnostic"
                    value={filterDiagnostic}
                    options={diagnosticFilterOptions}
                    isOpen={openDropdownId === 'diagnostic'}
                    onToggle={toggleDropdown}
                    onSelect={(value) => {
                      closeDropdowns();
                      handleDiagnosticChange(value);
                    }}
                    align="right"
                    menuWidthClassName="min-w-[240px]"
                  />

                  <AdminFilterDropdown
                    dropdownId="time-range"
                    value={filterTimeRange}
                    options={timeRangeFilterOptions}
                    isOpen={openDropdownId === 'time-range'}
                    onToggle={toggleDropdown}
                    onSelect={(value) => {
                      closeDropdowns();
                      handleTimeRangeChange(value);
                    }}
                    align="right"
                  />

                  {filterTimeRange === 'custom' && (
                    <>
                      <input
                        type="date"
                        value={filterStartDate}
                        onChange={(e) => setFilterStartDate(e.target.value)}
                        className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors sm:w-auto"
                      />
                      <input
                        type="date"
                        value={filterEndDate}
                        onChange={(e) => setFilterEndDate(e.target.value)}
                        className="w-full rounded-xl border border-white/15 bg-black/40 px-4 py-2.5 text-sm text-white focus:outline-none focus:border-purple-500 transition-colors sm:w-auto"
                      />
                      <button
                        onClick={() => {
                          closeDropdowns();
                          triggerRecordSearch();
                        }}
                        className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity sm:w-auto"
                      >
                        应用时间
                      </button>
                    </>
                  )}

                  <button
                    onClick={handleResetFilters}
                    className="w-full rounded-xl border border-white/12 px-3 py-2.5 text-sm text-white/65 hover:text-white hover:bg-white/10 transition-colors sm:w-auto"
                  >
                    重置
                  </button>
                </div>

                {activeToolSummary.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeToolSummary.map((option) => {
                      const active = filterToolPage === option.value;
                      return (
                        <button
                          key={option.value}
                          onClick={() => handleQuickFilter(option.value)}
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? getToolBadgeClass(option.label) : 'border-white/12 bg-white/[0.03] text-white/65 hover:bg-white/[0.08]'}`}
                        >
                          <span>{option.label}</span>
                          <span className="tabular-nums text-white/55">{option.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {diagnosticOptions.map((option) => {
                    const active = filterDiagnostic === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => handleQuickFilter(undefined, undefined, option.value)}
                        title={option.description}
                        className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs transition-colors ${active ? 'border-red-400/35 bg-red-500/10 text-red-100' : 'border-white/12 bg-white/[0.03] text-white/65 hover:bg-white/[0.08]'}`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {(totalStats.failureCount > 0 || totalStats.failureBreakdown.missingResultCount > 0) && (
                  <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                    <button
                      onClick={() => handleQuickFilter(undefined, '失败', 'upstream-error')}
                      className={`rounded-xl border p-3 text-left transition-colors ${filterDiagnostic === 'upstream-error' ? 'border-red-400/35 bg-red-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}
                    >
                      <div className="text-xs text-white/45">上游失败</div>
                      <div className="mt-2 text-2xl font-semibold tabular-nums text-red-200">{totalStats.failureBreakdown.upstreamErrorCount}</div>
                      <div className="mt-1 text-xs text-white/35">兼容接口或上游返回失败</div>
                    </button>

                    <button
                      onClick={() => handleQuickFilter(undefined, '失败', 'timeout-error')}
                      className={`rounded-xl border p-3 text-left transition-colors ${filterDiagnostic === 'timeout-error' ? 'border-orange-400/35 bg-orange-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}
                    >
                      <div className="text-xs text-white/45">超时异常</div>
                      <div className="mt-2 text-2xl font-semibold tabular-nums text-orange-200">{totalStats.failureBreakdown.timeoutErrorCount}</div>
                      <div className="mt-1 text-xs text-white/35">请求超时、连接中断或卡死</div>
                    </button>

                    <button
                      onClick={() => handleQuickFilter(undefined, undefined, 'missing-result')}
                      className={`rounded-xl border p-3 text-left transition-colors ${filterDiagnostic === 'missing-result' ? 'border-amber-400/35 bg-amber-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}
                    >
                      <div className="text-xs text-white/45">无结果</div>
                      <div className="mt-2 text-2xl font-semibold tabular-nums text-amber-200">{totalStats.failureBreakdown.missingResultCount}</div>
                      <div className="mt-1 text-xs text-white/35">成功或处理中但无有效结果图</div>
                    </button>

                    <button
                      onClick={() => handleQuickFilter(undefined, '失败', 'other-failure')}
                      className={`rounded-xl border p-3 text-left transition-colors ${filterDiagnostic === 'other-failure' ? 'border-white/25 bg-white/[0.08]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}
                    >
                      <div className="text-xs text-white/45">其他异常</div>
                      <div className="mt-2 text-2xl font-semibold tabular-nums text-white">{totalStats.failureBreakdown.otherFailureCount}</div>
                      <div className="mt-1 text-xs text-white/35">未归类失败，需人工排查</div>
                    </button>
                  </div>
                )}
              </div>

              {records.length === 0 && !loading ? (
                <div className="flex-1 flex items-center justify-center bg-white/5 rounded-xl border border-white/10">
                  <p className="text-white/60">暂无生图记录</p>
                </div>
              ) : (
                <div className="flex-1 min-h-0 bg-white/5 rounded-xl border border-white/10 overflow-hidden relative flex flex-col">
                  {loading && records.length > 0 && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/20 z-10 overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-purple-500 to-blue-500 animate-[loading_1.5s_ease-in-out_infinite]" style={{ width: '40%' }} />
                    </div>
                  )}
                  <div className="overflow-y-auto flex-1">
                    <table className="w-full min-w-[1220px]">
                      <thead className="sticky top-0 z-[1]">
                        <tr className="border-b border-white/10 bg-neutral-900/95 backdrop-blur">
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">用户</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">工具</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">状态</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">订单号</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">参考图</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">结果</th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">积分</th>
                          <th className="text-center px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">PSD</th>
                          <th className="text-left px-4 py-3 text-xs font-semibold text-white/60 uppercase tracking-wider">时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((record, idx) => {
                          const imageUrl = extractImageUrl(record.resultData);
                          const imageCount = getImageCount(record.resultData);
                          const requestImageUrls = getRequestImageUrls(record.requestParams, record.uploadedImage);
                          const requestPreviewUrl = requestImageUrls[0] || null;
                          const toolLabel = getNormalizedToolLabel(record.toolPage, record.description || '', record.orderNumber || '');
                          const diagnostic = getRecordDiagnostic(record);
                          const errorMessage = diagnostic.errorMessage;
                          const hasTimeoutError = diagnostic.key === 'timeout-error';
                          const hasUpstreamError = diagnostic.key === 'upstream-error';
                          const isMissingResult = diagnostic.key === 'missing-result';

                          let allImages: string[] = [];
                          if (record.resultData) {
                            if (typeof record.resultData === 'string') {
                              allImages = [record.resultData];
                            } else if (Array.isArray(record.resultData)) {
                              allImages = record.resultData;
                            } else if (typeof record.resultData === 'object' && record.resultData !== null) {
                              if (Array.isArray(record.resultData.result_image_url)) {
                                allImages = record.resultData.result_image_url;
                              } else if (record.resultData.result_image_url) {
                                allImages = [record.resultData.result_image_url];
                              }
                            }
                          }

                          return (
                            <tr
                              key={record.id}
                              className={`border-b border-white/10 last:border-0 cursor-pointer ${idx % 2 === 1 ? 'bg-white/[0.06]' : ''} hover:bg-white/20 transition-colors`}
                              onClick={() => setDetailModal({ open: true, record })}
                            >
                              {/* User */}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-full">
                                    <SafeImage
                                      src={record.userAvatar || '/images/avatar.png'}
                                      alt={record.username}
                                      fill
                                      sizes="28px"
                                      className="object-cover"
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium truncate">{record.username}</div>
                                    <div className="text-xs text-white/45 truncate">UID {record.userId.slice(0, 8)}</div>
                                  </div>
                                </div>
                              </td>

                              <td className="px-4 py-3">
                                <div className="flex flex-col gap-1">
                                  {renderToolBadge(record)}
                                  {record.toolPage && record.toolPage !== toolLabel && (
                                    <span className="text-xs text-white/45 truncate">原始: {record.toolPage}</span>
                                  )}
                                </div>
                              </td>

                              {/* Status */}
                              <td className="px-4 py-3">
                                {getStatusBadge(record.status)}
                              </td>

                              <td className="px-4 py-3 max-w-[220px]">
                                <div className="text-sm font-mono text-white/85 truncate">{record.orderNumber}</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {isMissingResult && (
                                    <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200">无结果</span>
                                  )}
                                  {hasUpstreamError && (
                                    <span className="rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-200">上游失败</span>
                                  )}
                                  {hasTimeoutError && (
                                    <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-200">超时异常</span>
                                  )}
                                  {requestImageUrls.length > 0 && (
                                    <span className="rounded-full border border-white/12 bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/60">{requestImageUrls.length} 张参考</span>
                                  )}
                                </div>
                              </td>

                              <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                {requestPreviewUrl ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPreviewImages(requestImageUrls);
                                        setPreviewIndex(0);
                                      }}
                                      className="relative h-14 w-20 overflow-hidden rounded-lg transition-opacity hover:opacity-80"
                                    >
                                      <SafeImage
                                        src={requestPreviewUrl}
                                        alt="参考图"
                                        fill
                                        sizes="80px"
                                        className="object-cover"
                                      />
                                    </button>
                                    <span className="text-[10px] text-white/45">{requestImageUrls.length > 1 ? `${requestImageUrls.length} 张参考` : '参考图'}</span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-white/60">无</span>
                                )}
                              </td>

                              {/* Result image */}
                              <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                {imageUrl ? (
                                  <div className="flex flex-col items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setPreviewImages(allImages);
                                        setPreviewIndex(0);
                                      }}
                                      className="relative h-14 w-20 overflow-hidden rounded-lg transition-opacity hover:opacity-80"
                                    >
                                      <SafeImage
                                        src={imageUrl}
                                        alt="结果"
                                        fill
                                        sizes="80px"
                                        className="object-cover"
                                      />
                                    </button>
                                    <span className="text-[10px] text-emerald-300">{imageCount > 1 ? `${imageCount} 张结果` : '已产出'}</span>
                                  </div>
                                ) : record.status === '失败' ? (
                                  <div className="mx-auto max-w-[180px] rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-left text-xs text-red-200">
                                    {errorMessage}
                                  </div>
                                ) : record.status === '处理中' ? (
                                  <span className="inline-flex items-center gap-2 text-xs text-sky-300">
                                    <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                                    等待结果
                                  </span>
                                ) : isMissingResult ? (
                                  <span className="inline-flex items-center gap-2 text-xs text-amber-300">
                                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                                    结果缺失
                                  </span>
                                ) : (
                                  <span className="text-xs text-white/60">-</span>
                                )}
                              </td>

                              {/* Points */}
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-sm font-medium tabular-nums">
                                    {record.actualPoints > 0 ? record.actualPoints : 0}
                                  </span>
                                  <SafeImage src="/points-icon.png" alt="积分" width={14} height={14} className="h-3.5 w-3.5" />
                                </div>
                                {record.points !== record.actualPoints && record.status === '成功' && (
                                  <div className="text-xs text-white/60 tabular-nums">
                                    预估 {record.points}
                                  </div>
                                )}
                              </td>

                              {/* PSD */}
                              <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                {record.toolPage === '彩绘提取' && record.status === '成功' && record.psdUrl ? (
                                  <button
                                    onClick={async () => {
                                      try {
                                        showToast('正在下载PSD文件...', 'info');
                                        const controller = new AbortController();
                                        const timeoutId = setTimeout(() => controller.abort(), 60000);
                                        const response = await fetch(record.psdUrl!, { signal: controller.signal });
                                        clearTimeout(timeoutId);
                                        if (!response.ok) throw new Error(`下载失败: ${response.status}`);
                                        const blob = await response.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.href = url;
                                        link.download = `${record.orderNumber}.psd`;
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        window.URL.revokeObjectURL(url);
                                        showToast('PSD文件下载成功', 'success');
                                      } catch (error: unknown) {
                                        if (error instanceof Error && error.name === 'AbortError') {
                                          showToast('下载超时，请重试', 'error');
                                        } else {
                                          showToast(toUserFacingErrorFromUnknown(error, '下载失败，请重试'), 'error');
                                        }
                                      }
                                    }}
                                    className="text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                                  >
                                    下载
                                  </button>
                                ) : (
                                  <span className="text-xs text-white/60">-</span>
                                )}
                              </td>

                              {/* Time */}
                              <td className="px-4 py-3">
                                <span className="text-xs text-white/60 whitespace-nowrap">
                                  {formatTime(record.createdAt)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {hasMore && records.length > 0 && (
                    <div className="text-center py-3 border-t border-white/10 flex-shrink-0">
                      <button
                        onClick={handleLoadMore}
                        disabled={loading}
                        className="px-6 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                      >
                        {loading ? '加载中...' : '加载更多'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Image preview modal */}
          {previewImages.length > 0 && (
            <div
              className="fixed inset-0 z-50 flex flex-col items-center justify-center p-8"
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.9)' }}
              onClick={() => {
                setPreviewImages([]);
                setPreviewIndex(0);
              }}
            >
              <div className="text-white/80 mb-4 text-sm">
                图片 {previewIndex + 1} / {previewImages.length}
              </div>
              <div className="relative w-full max-w-5xl h-full max-h-[80vh] flex items-center justify-center">
                {previewImages.length > 1 && previewIndex > 0 && (
                  <button
                    className="absolute left-4 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewIndex(prev => Math.max(0, prev - 1));
                    }}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}

                <SafeImage
                  src={previewImages[previewIndex]}
                  alt={`预览 ${previewIndex + 1}`}
                  fill
                  sizes="100vw"
                  className="object-contain"
                />

                {previewImages.length > 1 && previewIndex < previewImages.length - 1 && (
                  <button
                    className="absolute right-4 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewIndex(prev => Math.min(previewImages.length - 1, prev + 1));
                    }}
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>

              {previewImages.length > 1 && (
                <div className="flex gap-2 mt-4 overflow-x-auto max-w-full">
                  {previewImages.map((img, idx) => (
                    <button
                      key={idx}
                      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                        idx === previewIndex ? 'border-white' : 'border-transparent hover:border-white/30'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewIndex(idx);
                      }}
                    >
                      <div className="relative h-full w-full">
                        <SafeImage src={img} alt={`缩略图 ${idx + 1}`} fill sizes="64px" className="object-cover" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Edit modal */}
          {editModal.open && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-8"
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
            >
              <div className="bg-black border border-white/20 rounded-2xl p-6 max-w-md w-full shadow-xl">
                <h2 className="text-lg font-bold mb-4">
                  {editModal.type === 'points' ? '修改积分' : '修改头像'}
                </h2>

                {editModal.type === 'points' ? (
                  <div className="mb-6">
                    <label className="block text-white/60 text-sm mb-2">积分数值</label>
                    <input
                      type="number"
                      min="0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                    />
                    <p className="text-white/60 text-xs mt-2">当前积分: {editModal.currentData}</p>
                  </div>
                ) : (
                  <div className="mb-6">
                    <label className="block text-white/60 text-sm mb-2">头像URL</label>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder="输入图片URL"
                      className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                    />
                    {typeof editModal.currentData === 'string' && editModal.currentData && (
                      <div className="mt-4">
                        <p className="text-white/60 text-xs mb-2">当前头像:</p>
                        <SafeImage
                          src={editModal.currentData}
                          alt="当前头像"
                          width={48}
                          height={48}
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closeEditModal}
                    className="px-4 py-2 border border-white/10 rounded-lg text-sm hover:bg-white/20 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Detail modal */}
          {detailModal.open && detailRecord && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-8"
              style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
              onClick={() => setDetailModal({ open: false, record: null })}
            >
              <div className="bg-black border border-white/20 rounded-2xl p-6 max-w-4xl w-full max-h-[84vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-5">
                  <h2 className="text-lg font-bold">订单详情</h2>
                  <button
                    onClick={() => setDetailModal({ open: false, record: null })}
                    className="text-white/60 hover:text-white transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-xs text-white/45">订单号</div>
                      <div className="mt-2 text-sm font-mono break-all">{detailRecord.orderNumber}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-xs text-white/45">工具</div>
                      <div className="mt-2">{renderToolBadge(detailRecord)}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-xs text-white/45">状态</div>
                      <div className="mt-2">{getStatusBadge(detailRecord.status)}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-xs text-white/45">积分</div>
                      <div className="mt-2 text-sm">
                        <span className="font-medium tabular-nums">{detailRecord.actualPoints > 0 ? detailRecord.actualPoints : 0}</span>
                        {detailRecord.points !== detailRecord.actualPoints && detailRecord.status === '成功' && (
                          <span className="ml-2 text-white/50">预估 {detailRecord.points}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
                    <div className="space-y-4">
                      {detailDiagnostic && (
                        <div className={`rounded-xl border p-4 ${detailDiagnostic.panelClass}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs text-white/55">故障摘要</div>
                              <div className={`mt-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${detailDiagnostic.badgeClass}`}>
                                {detailDiagnostic.label}
                              </div>
                            </div>
                            <button
                              onClick={() => handleDiagnosticShortcut(detailDiagnostic.key)}
                              className="rounded-lg border border-white/12 px-2.5 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                            >
                              查看同类订单
                            </button>
                          </div>
                          <div className={`mt-3 text-sm leading-6 ${detailDiagnostic.textClass}`}>
                            {detailDiagnostic.summary}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/55">
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">结果图 {detailDiagnostic.resultImageCount} 张</span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">参考图 {detailDiagnostic.requestImageCount} 张</span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">状态 {detailRecord.status}</span>
                          </div>
                          {detailDiagnostic.key !== 'healthy' && detailDiagnostic.errorMessage && detailDiagnostic.errorMessage !== '未知错误' && (
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/25 p-3 text-xs text-white/75 break-words">
                              {detailDiagnostic.errorMessage}
                            </div>
                          )}
                        </div>
                      )}

                      {detailRecommendations.length > 0 && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                          <div className="text-xs text-white/45">故障处理建议</div>
                          <div className="mt-3 space-y-3">
                            {detailRecommendations.map((item, index) => (
                              <div key={`${item.title}-${index}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
                                <div className="text-sm font-medium text-white/90">{index + 1}. {item.title}</div>
                                <div className="mt-1 text-sm leading-6 text-white/65">{item.detail}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-xs text-white/45">用户</div>
                        <div className="mt-3 flex items-center gap-3">
                          <div className="relative h-9 w-9 overflow-hidden rounded-full">
                            <SafeImage
                              src={detailRecord.userAvatar || '/images/avatar.png'}
                              alt={detailRecord.username}
                              fill
                              sizes="36px"
                              className="object-cover"
                            />
                          </div>
                          <div>
                            <div className="text-sm font-medium">{detailRecord.username}</div>
                            <div className="text-xs text-white/45">{detailRecord.userId}</div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-xs text-white/45">订单说明</div>
                        <div className="mt-3 text-sm whitespace-pre-wrap break-words text-white/85">
                          {detailRecord.description || detailRecord.prompt || '无'}
                        </div>
                      </div>

                      {detailSmartEditAgent && (
                        <div className="rounded-xl border border-sky-300/18 bg-sky-500/[0.08] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs text-sky-100/65">智能改图 Agent</div>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-sky-50/72">
                                <span className="rounded-full border border-sky-200/18 bg-black/20 px-2.5 py-1">来源 {detailSmartEditAgent.promptSource || 'unknown'}</span>
                                <span className="rounded-full border border-sky-200/18 bg-black/20 px-2.5 py-1">模式 {detailSmartEditAgent.mode === 'tag' ? '标记' : detailSmartEditAgent.mode === 'brush' ? '画笔' : detailSmartEditAgent.mode || '-'}</span>
                                <span className="rounded-full border border-sky-200/18 bg-black/20 px-2.5 py-1">标记 {detailSmartEditAgent.regionCount ?? 0} 个</span>
                                <span className="rounded-full border border-sky-200/18 bg-black/20 px-2.5 py-1">比例 {detailSmartEditAgent.requestedAspectRatio || 'auto'} {'->'} {detailSmartEditAgent.resolvedAspectRatio || '-'}</span>
                                <span className="rounded-full border border-sky-200/18 bg-black/20 px-2.5 py-1">目标 {detailSmartEditAgent.editTarget || 'primary'}{detailSmartEditAgent.usedFallback ? ' / fallback' : ''}</span>
                              </div>
                            </div>
                            <div className="text-right text-[11px] leading-5 text-sky-100/45">
                              <div>{detailSmartEditAgent.agentName || 'material-editor-prompt-agent'}</div>
                              <div>{detailSmartEditAgent.agentModel || '-'} / {detailSmartEditAgent.editModel || '-'}</div>
                              <div className="max-w-[280px] truncate">{detailSmartEditAgent.editBaseUrl || '-'}</div>
                            </div>
                          </div>

                          {detailSmartEditAgent.userInstruction && (
                            <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
                              <div className="text-xs text-sky-100/50">用户原始要求</div>
                              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/82">{detailSmartEditAgent.userInstruction}</div>
                            </div>
                          )}

                          {detailSmartEditAgent.summary && (
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                              <div className="text-xs text-sky-100/50">Agent 摘要</div>
                              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/82">{detailSmartEditAgent.summary}</div>
                            </div>
                          )}

                          {detailSmartEditAgent.finalPrompt && (
                            <div className="mt-3 rounded-lg border border-white/10 bg-black/30 p-3">
                              <div className="text-xs text-sky-100/50">最终提示词</div>
                              <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white/86">{detailSmartEditAgent.finalPrompt}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {detailRecord.status === '失败' && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                          <div className="text-xs text-red-200/80">失败原因</div>
                          <div className="mt-2 text-sm text-red-100 break-words">{getResultErrorMessage(detailRecord.resultData)}</div>
                        </div>
                      )}

                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-xs text-white/45">创建时间</div>
                        <div className="mt-2 text-sm">{new Date(detailRecord.createdAt).toLocaleString('zh-CN')}</div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-white/45">结果图片</div>
                          <div className="text-xs text-white/35">{detailResultImages.length || 0} 张</div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {detailResultImages.length > 0 ? detailResultImages.map((url, index) => (
                            <button
                              type="button"
                              key={`${url}-${index}`}
                              onClick={() => {
                                setPreviewImages(detailResultImages);
                                setPreviewIndex(index);
                              }}
                              className="relative h-32 overflow-hidden rounded-xl border border-white/10 bg-black/30"
                            >
                              <SafeImage src={url} alt={`结果 ${index + 1}`} fill sizes="(max-width: 768px) 50vw, 320px" className="object-cover" />
                            </button>
                          )) : (
                            <div className="col-span-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">暂无结果图</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-white/45">参考图片</div>
                          <div className="text-xs text-white/35">{detailRequestImages.length || 0} 张</div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {detailRequestImages.length > 0 ? detailRequestImages.map((url, index) => (
                            <button
                              type="button"
                              key={`${url}-${index}`}
                              onClick={() => {
                                setPreviewImages(detailRequestImages);
                                setPreviewIndex(index);
                              }}
                              className="relative h-32 overflow-hidden rounded-xl border border-white/10 bg-black/30"
                            >
                              <SafeImage src={url} alt={`参考 ${index + 1}`} fill sizes="(max-width: 768px) 50vw, 320px" className="object-cover" />
                            </button>
                          )) : (
                            <div className="col-span-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">无参考图</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <details className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <summary className="cursor-pointer text-sm font-medium text-white/80">查看原始请求参数</summary>
                    <div className="mt-3 overflow-auto rounded-lg border border-white/8 bg-black/30 p-3">
                      <pre className="text-xs text-white/70">{JSON.stringify(detailRecord.requestParams, null, 2)}</pre>
                    </div>
                  </details>

                  <details className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <summary className="cursor-pointer text-sm font-medium text-white/80">查看原始结果数据</summary>
                    <div className="mt-3 overflow-auto rounded-lg border border-white/8 bg-black/30 p-3">
                      <pre className="text-xs text-white/70">{JSON.stringify(detailRecord.resultData, null, 2)}</pre>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </>
  );
}
