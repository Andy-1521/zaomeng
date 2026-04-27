import { deleteCache, getCache, setCache } from "@/lib/redis";

type VerifyCodePayload = {
  code: string;
  expireAt: number;
};

function getKey(identifier: string) {
  return `verify-code:${identifier}`;
}

class VerifyCodeStore {
  async set(identifier: string, code: string, expireMinutes = 5) {
    const expireAt = Date.now() + expireMinutes * 60 * 1000;
    await setCache<VerifyCodePayload>(getKey(identifier), { code, expireAt }, expireMinutes * 60);
  }

  async check(identifier: string, code: string): Promise<boolean> {
    const stored = await getCache<VerifyCodePayload>(getKey(identifier));

    if (!stored) {
      return false;
    }

    if (Date.now() > stored.expireAt) {
      await this.remove(identifier);
      return false;
    }

    return stored.code === code;
  }

  async verify(identifier: string, code: string): Promise<boolean> {
    const isValid = await this.check(identifier, code);

    if (isValid) {
      await this.remove(identifier);
    }

    return isValid;
  }

  async remove(identifier: string): Promise<boolean> {
    return (await deleteCache(getKey(identifier))) > 0;
  }

  async cleanup() {
    return;
  }
}

export const verifyCodeStore = new VerifyCodeStore();
