const decryptP = {
  QR: 0,
  xa: 1,
  cL: 2,
  pF: 3,
  Oe: 4,
  bn: 5,
  sM: 6,
  yt: 7,
  Uv: 8,
  ik: 9,
};

export const func = {
  isSkipIp(ip?: string) {
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip.includes('::ffff')) return true;
    return false;
  },
  randomString(len = 7) {
    const $chars = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz23456789';
    const maxPos = $chars.length;
    let pwd = '';
    for (let i = 0; i < len; i++) {
      pwd += $chars.charAt(Math.floor(Math.random() * maxPos));
    }
    return pwd + Date.now();
  },
  result<T>(jn: Partial<{code: number; desc: string; data: T; time?: number}> = {}) {
    // return Object.assign({ code: 1000, desc: '成功', data: '' }, jn);
    return jn.data;
  },
  errResult<T>(jn: Partial<{code: number; desc: string; data: T; time?: number}> = {}) {
    // return Object.assign({ code: 1010, desc: '请求失败', data: '' }, jn);
    return jn.data;
  },
  format(date: Date, fmt: string) {
    const o: Record<string, number> = {
      'M+': date.getMonth() + 1,
      'd+': date.getDate(),
      'h+': date.getHours(),
      'H+': date.getHours() > 12 ? date.getHours() - 12 : date.getHours(),
      'm+': date.getMinutes(),
      's+': date.getSeconds(),
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (date.getFullYear() + '').substr(4 - RegExp.$1.length));
    for (const k in o) {
      if (new RegExp('(' + k + ')').test(fmt)) {
        fmt = fmt.replace(RegExp.$1, RegExp.$1.length === 1 ? String(o[k]) : ('00' + o[k]).substr(('' + o[k]).length));
      }
    }
    return fmt;
  },
  getRealIp(headers: Record<string, any>, ip?: string) {
    return headers['x-real-ip'] || headers['x-forwarded-for'] || ip;
  },
  // 简化：将路径段中的纯数字替换为 *
  urlHelper(input: string) {
    try {
      const schemeIdx = input.indexOf('://');
      if (schemeIdx !== -1) {
        const pathStart = input.indexOf('/', schemeIdx + 3);
        if (pathStart === -1) return input;
        const head = input.slice(0, pathStart);
        const path = input.slice(pathStart).replace(/\/\d+\b/g, '/*');
        return head + path;
      }
      return input.replace(/\/\d+\b/g, '/*');
    } catch {
      return input;
    }
  },
  // 新增：对象判断（包含数组）
  isObject(input: any) {
    return input !== null && typeof input === 'object';
  },
  filterKeyWord(input: any) {
    try {
      return typeof input === 'string' ? input : JSON.stringify(input);
    } catch {
      return '';
    }
  },
  decryptPhone(str) {
    if (typeof str !== 'string') return str;
    let t = '';
    return str
      .split('')
      .map(item => {
        t += item;
        if (t.length === 2) {
          const r = decryptP[t];
          t = '';
          return r;
        }
      })
      .join('');
  },
  setMatchTime(query, $match) {
    const createTime: any = {};
    if (query.beginTime) {
      createTime.$gte = new Date(query.beginTime);
      $match.createTime = createTime;
    }
    if (query.endTime) {
      createTime.$lte = new Date(query.endTime);
      $match.createTime = createTime;
    }
  },
};

const ips = ['118.112.75.70', '119.57.35.106', '221.231.219.26', '140.206.142.182'];
export const getRandomIp = () => ips[Math.floor(Math.random() * ips.length)];
