import ExcelJS from 'exceljs';
import type { AppState, JerseyVersion } from '../types/erp';
import { normalizeVersionDisplay } from './finance';
import {
  obtenerFallbackUrlImagen,
  parseCatalogImageList,
  resolveCatalogPhoto,
} from './publicCatalog';

export interface SupplierOrderInputLine {
  team: string;
  model: string;
  version: JerseyVersion;
  player: string;
  size: string;
  orderQty: number;
}

export interface SupplierPlayerColumn {
  key: string;
  label: string; // Latin letters + numbers, or '无印号'
  qtyBySize: Record<string, number>;
}

export interface SupplierOrderGroup {
  groupKey: string;
  team: string;
  baseModel: string;
  rawModelSample: string;
  version: JerseyVersion;
  chineseModelTitle: string;
  defaultPatch: string;
  photoUrl?: string;
  players: SupplierPlayerColumn[];
  sizesToRender: string[];
  totalUnits: number;
}

export interface SupplierPatchOption {
  value: string;
  label: string;
}

export const DEFAULT_SUPPLIER_PATCH = '欧洲冠军联赛';

export const SUPPLIER_PATCH_OPTIONS: SupplierPatchOption[] = [
  { value: '欧洲冠军联赛', label: '欧洲冠军联赛 (Champions League)' },
  { value: '2026年世界杯纪念章', label: '2026年世界杯纪念章 (Mundial 2026)' },
  { value: '西甲联赛臂章', label: '西甲联赛臂章 (La Liga)' },
  { value: '英超联赛臂章', label: '英超联赛臂章 (Premier League)' },
  { value: '法甲联赛臂章', label: '法甲联赛臂章 (Ligue 1)' },
  { value: '意甲联赛臂章', label: '意甲联赛臂章 (Serie A)' },
  { value: '德甲联赛臂章', label: '德甲联赛臂章 (Bundesliga)' },
  { value: '无臂章', label: '无臂章 (Sin parche)' },
];

const STANDARD_SUPPLIER_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;

const CLUB_AND_COUNTRY_ZH: Array<[RegExp, string]> = [
  [/\bparis\s+saint[\s-]+germain\b|\bpsg\b|\bparis\b/gi, '巴黎圣日耳曼'],
  [/\breal\s+madrid\b|\bmadrid\b/gi, '皇家马德里'],
  [/\batl[eé]tico(?:\s+de)?\s+madrid\b|\batleti\b/gi, '马德里竞技'],
  [/\bfc\s+barcelona\b|\bbarcelona\b|\bbarca\b|\bbarça\b/gi, '巴塞罗那'],
  [/\bmanchester\s+city\b|\bman\s+city\b|\bcity\b/gi, '曼城'],
  [/\bmanchester\s+united\b|\bman\s+utd\b|\bman\s+united\b/gi, '曼联'],
  [/\bbayern\s+m[uü]nchen\b|\bbayern\s+munich\b|\bbayern\b/gi, '拜仁慕尼黑'],
  [/\bborussia\s+dortmund\b|\bdortmund\b|\bbvb\b/gi, '多特蒙德'],
  [/\bbayer\s+leverkusen\b|\bleverkusen\b/gi, '勒沃库森'],
  [/\binter(?:\s+de)?\s+miami\b/gi, '迈阿密国际'],
  [/\binter(?:\s+de)?\s+mil[aá]n\b|\binternazionale\b/gi, '国际米兰'],
  [/\bac\s+mil[aá]n\b|\bmil[aá]n\b/gi, 'AC米兰'],
  [/\bjuventus\b|\bjuve\b/gi, '尤文图斯'],
  [/\bnapoli\b|\bn[aá]poles\b/gi, '那不勒斯'],
  [/\broma\b/gi, '罗马'],
  [/\barsenal\b/gi, '阿森纳'],
  [/\bliverpool\b/gi, '利物浦'],
  [/\bchelsea\b/gi, '切尔西'],
  [/\btottenham\b|\bspurs\b/gi, '热刺'],
  [/\bnewcastle\b/gi, '纽卡斯尔'],
  [/\baston\s+villa\b/gi, '阿斯顿维拉'],
  [/\briver\s+plate\b|\briver\b/gi, '河床队'],
  [/\bboca\s+juniors\b|\bboca\b/gi, '博卡青年'],
  [/\bflamengo\b/gi, '弗拉门戈'],
  [/\bpalmeiras\b/gi, '帕尔梅拉斯'],
  [/\bsantos\b/gi, '桑托斯'],
  [/\bal[\s-]+nassr\b/gi, '利雅得胜利'],
  [/\bal[\s-]+hilal\b/gi, '利雅得新月'],
  [/\bajax\b/gi, '阿贾克斯'],
  [/\bbenfica\b/gi, '本菲卡'],
  [/\bporto\b|\boporto\b/gi, '波尔图'],
  [/\bsporting(?:\s+cp|\s+lisboa)?\b/gi, '葡萄牙体育'],
  [/\bportugal\b/gi, '葡萄牙'],
  [/\balemania\b|\bgermany\b/gi, '德国'],
  [/\bargentina\b/gi, '阿根廷'],
  [/\bbrasil\b|\bbrazil\b/gi, '巴西'],
  [/\bfrancia\b|\bfrance\b/gi, '法国'],
  [/\bespa[nñ]a\b|\bspain\b/gi, '西班牙'],
  [/\binglaterra\b|\bengland\b/gi, '英格兰'],
  [/\bitalia\b|\bitaly\b/gi, '意大利'],
  [/\bholanda\b|\bpa[ií]ses\s+bajos\b|\bnetherlands\b/gi, '荷兰'],
  [/\bb[eé]lgica\b|\bbelgium\b/gi, '比利时'],
  [/\bcroacia\b|\bcroatia\b/gi, '克罗地亚'],
  [/\bvenezuela\b|\bvinotinto\b/gi, '委内瑞拉'],
  [/\bcolombia\b/gi, '哥伦比亚'],
  [/\buruguay\b/gi, '乌拉圭'],
  [/\bm[eé]xico\b|\bmexico\b/gi, '墨西哥'],
  [/\bestados\s+unidos\b|\busa\b/gi, '美国'],
  [/\bjap[oó]n\b|\bjapan\b/gi, '日本'],
  [/\bcorea(?:\s+del\s+sur)?\b|\bkorea\b/gi, '韩国'],
  [/\bmarruecos\b|\bmorocco\b/gi, '摩洛哥'],
  [/\bchile\b/gi, '智利'],
  [/\becuador\b/gi, '厄瓜多尔'],
  [/\bper[uú]\b/gi, '秘鲁'],
];

const KIT_TERMS_ZH: Array<[RegExp, string]> = [
  [/\btercer(?:a)?(?:\s+equipaci[oó]n)?\b|\b3ra\b|\bthird\b/gi, '第三客场'],
  [/\bcuart(?:a)?(?:\s+equipaci[oó]n)?\b|\b4ta\b|\bfourth\b/gi, '第四客场'],
  [/\bvisitante\b|\bvisita\b|\baway\b/gi, '客场'],
  [/\blocal\b|\bhome\b|\btitular\b/gi, '主场'],
  [/\bmanga\s+larga\b|\blong\s+sleeve\b|\bls\b/gi, '长袖'],
  [/\bportero\b|\barquero\b|\bgoalkeeper\b|\bgk\b/gi, '门将'],
  [/\bentrenamiento\b|\btraining\b/gi, '训练服'],
  [/\bedici[oó]n\s+especial\b|\bespecial\b|\bspecial\b/gi, '特别版'],
  [/\baniversario\b|\banniversary\b/gi, '周年纪念版'],
  [/\bmujeres\b|\bmujer\b|\bdama\b|\bwomen\b/gi, '女款'],
  [/\bni[nñ]os?\b|\binfantil\b|\bjunior\b|\bkids\b/gi, '儿童套装'],
];

const NOISE_WORDS_RE =
  /\b(?:camiseta|franela|jersey|equipaci[oó]n|temporada|temp|versi[oó]n|version|edici[oó]n|selecci[oó]n|club|equipo|f[uú]tbol|de|del|la|el|con|para|y)\b/gi;

function stripAccentsLower(val: string): string {
  return (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function extractBaseModelAndPlayer(
  rawModel: string,
  fallbackPlayer: string,
): { baseModel: string; playerLabel: string } {
  let cleanModel = (rawModel || '').trim();
  let playerCandidate = (fallbackPlayer || '').trim();

  // Extract explicit separator like "Model · Mbappé #9" or "Model | Yamal #10"
  const sepParts = cleanModel
    .split(/\s*[·|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (sepParts.length > 1) {
    cleanModel = sepParts[0];
    if (!playerCandidate || playerCandidate === '—') {
      playerCandidate = sepParts.slice(1).join(' ');
    }
  }

  // Extract "(Mbappé #9)" if inside parentheses
  const parenMatch = cleanModel.match(/\(([^)]*#\d+[^)]*)\)/);
  if (parenMatch?.[1]) {
    if (!playerCandidate || playerCandidate === '—') {
      playerCandidate = parenMatch[1].trim();
    }
    cleanModel = cleanModel.replace(parenMatch[0], '').trim();
  }

  // Strip trailing "Name #10" if present
  const trailingHashMatch = cleanModel.match(
    /\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+)?\s*#\d+)\s*$/,
  );
  if (trailingHashMatch?.[1]) {
    if (!playerCandidate || playerCandidate === '—') {
      playerCandidate = trailingHashMatch[1].trim();
    }
    cleanModel = cleanModel.slice(0, cleanModel.length - trailingHashMatch[0].length).trim();
  }

  // Format player label strictly in Latin uppercase + number without '#'
  let playerLabel = '无印号';
  if (playerCandidate && playerCandidate !== '—') {
    const formatted = playerCandidate
      .replace(/#/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
    if (formatted) {
      playerLabel = formatted;
    }
  }

  return {
    baseModel: cleanModel || rawModel.trim(),
    playerLabel,
  };
}

export function translateVersionToChinese(
  version: JerseyVersion,
  rawModel = '',
): string {
  const modelNorm = stripAccentsLower(rawModel);
  if (
    /\b(nino|ninos|kids|junior|infantil|conjunto)\b/.test(modelNorm)
  ) {
    return '儿童套装';
  }
  const canonical = normalizeVersionDisplay(version);
  switch (canonical) {
    case 'Player':
      return '球员版';
    case 'Retro':
      return '复古版';
    case 'Fans':
    default:
      return '球迷版';
  }
}

function normalizeSeasonToken(raw: string): string {
  // Replace 25/26 -> 2025/2026, 26/27 -> 2026/2027, 2025/26 -> 2025/2026
  return raw
    .replace(/\b20(\d{2})\s*[-/]\s*(\d{2})\b/g, '20$1/20$2')
    .replace(/\b(\d{2})\s*[-/]\s*(\d{2})\b/g, (_m, a: string, b: string) => {
      const y1 = Number(a) >= 80 ? `19${a}` : `20${a}`;
      const y2 = Number(b) >= 80 ? `19${b}` : `20${b}`;
      return `${y1}/${y2}`;
    })
    .replace(/\b20(\d{2})\s*[-/]\s*20(\d{2})\b/g, '20$1/20$2');
}

export function translateJerseyModelToChinese(
  baseModel: string,
  version: JerseyVersion,
  teamHint = '',
): string {
  let working = `${baseModel || ''}`.trim();
  if (!working && teamHint) working = teamHint.trim();

  let matchedClub = '';
  for (const [regex, zh] of CLUB_AND_COUNTRY_ZH) {
    regex.lastIndex = 0;
    if (regex.test(working)) {
      matchedClub = zh;
      regex.lastIndex = 0;
      working = working.replace(regex, ' ');
      break;
    }
  }

  if (!matchedClub && teamHint) {
    for (const [regex, zh] of CLUB_AND_COUNTRY_ZH) {
      regex.lastIndex = 0;
      if (regex.test(teamHint)) {
        matchedClub = zh;
        break;
      }
    }
  }

  const kitTags: string[] = [];
  for (const [regex, zh] of KIT_TERMS_ZH) {
    regex.lastIndex = 0;
    if (regex.test(working)) {
      if (!kitTags.includes(zh)) kitTags.push(zh);
      regex.lastIndex = 0;
      working = working.replace(regex, ' ');
    }
  }

  // Strip explicit version words in Spanish/English since we append canonical Chinese version
  working = working
    .replace(/\b(player|jugador|fans?|aficionado|estadio|stadium|retro|cl[aá]sica|vintage)\b/gi, ' ')
    .replace(NOISE_WORDS_RE, ' ');

  const normalizedSeasons = normalizeSeasonToken(working);
  const seasonMatch = normalizedSeasons.match(/\b(?:19|20)\d{2}(?:\/(?:19|20)\d{2})?\b/);
  const seasonStr = seasonMatch ? seasonMatch[0] : '';

  const versionZh = translateVersionToChinese(version, baseModel);

  const parts: string[] = [];
  if (matchedClub) {
    parts.push(matchedClub);
  } else if (teamHint.trim()) {
    parts.push(teamHint.trim());
  }
  for (const tag of kitTags) {
    if (tag !== versionZh) parts.push(tag);
  }
  parts.push(versionZh);
  if (seasonStr) parts.push(seasonStr);

  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function resolveGroupPhotoCandidates(
  rawModel: string,
  baseModel: string,
  version: JerseyVersion,
  state: AppState,
): string[] {
  const candidates: string[] = [];
  const pushRaw = (raw?: string) => {
    if (!raw || typeof raw !== 'string') return;
    for (const url of parseCatalogImageList(raw)) {
      if (!candidates.includes(url)) candidates.push(url);
      const fb = obtenerFallbackUrlImagen(url);
      if (fb && !candidates.includes(fb)) candidates.push(fb);
    }
  };

  // 1) Check optional image/imageUrl/photo fields on state.inventory (exact version first, then any version)
  const targetRaw = stripAccentsLower(rawModel);
  const targetBase = stripAccentsLower(baseModel);
  const targetVer = normalizeVersionDisplay(version);
  for (const inv of state.inventory ?? []) {
    const invRec = inv as unknown as Record<string, unknown>;
    const invModelNorm = stripAccentsLower(inv.model);
    if (
      (invModelNorm === targetRaw || invModelNorm === targetBase) &&
      normalizeVersionDisplay(inv.version) === targetVer
    ) {
      for (const field of ['image', 'imageUrl', 'photo', 'imagen', 'foto']) {
        const val = invRec[field];
        if (typeof val === 'string' && val.trim()) {
          pushRaw(val);
        }
      }
    }
  }
  for (const inv of state.inventory ?? []) {
    const invRec = inv as unknown as Record<string, unknown>;
    const invModelNorm = stripAccentsLower(inv.model);
    if (invModelNorm === targetRaw || invModelNorm === targetBase) {
      for (const field of ['image', 'imageUrl', 'photo', 'imagen', 'foto']) {
        const val = invRec[field];
        if (typeof val === 'string' && val.trim()) {
          pushRaw(val);
        }
      }
    }
  }

  // 2) Check state.catalogPhotos using rawModel & baseModel, then cross-version fallback
  pushRaw(resolveCatalogPhoto(rawModel, version, state.catalogPhotos));
  if (baseModel !== rawModel) {
    pushRaw(resolveCatalogPhoto(baseModel, version, state.catalogPhotos));
  }
  for (const altVer of ['Fans', 'Player', 'Retro'] as JerseyVersion[]) {
    if (altVer === targetVer) continue;
    pushRaw(resolveCatalogPhoto(baseModel, altVer, state.catalogPhotos));
    if (rawModel !== baseModel) {
      pushRaw(resolveCatalogPhoto(rawModel, altVer, state.catalogPhotos));
    }
  }

  return candidates;
}

export function buildSupplierOrderGroups(
  lines: SupplierOrderInputLine[],
  state: AppState,
): SupplierOrderGroup[] {
  const groupMap = new Map<
    string,
    {
      groupKey: string;
      team: string;
      baseModel: string;
      rawModelSample: string;
      version: JerseyVersion;
      playersMap: Map<string, SupplierPlayerColumn>;
      extraSizes: Set<string>;
      totalUnits: number;
    }
  >();

  for (const line of lines) {
    const qty = Math.max(0, Math.floor(Number(line.orderQty) || 0));
    if (qty <= 0) continue;

    const ver = normalizeVersionDisplay(line.version);
    const { baseModel, playerLabel } = extractBaseModelAndPlayer(
      line.model,
      line.player,
    );
    const groupKey = `${stripAccentsLower(baseModel)}::${ver}`;

    let grp = groupMap.get(groupKey);
    if (!grp) {
      grp = {
        groupKey,
        team: line.team,
        baseModel,
        rawModelSample: line.model,
        version: ver,
        playersMap: new Map(),
        extraSizes: new Set(),
        totalUnits: 0,
      };
      groupMap.set(groupKey, grp);
    }

    const sizeUpper = String(line.size || '').trim().toUpperCase() || 'M';
    if (
      !(STANDARD_SUPPLIER_SIZES as readonly string[]).includes(sizeUpper)
    ) {
      grp.extraSizes.add(sizeUpper);
    }

    let pCol = grp.playersMap.get(playerLabel);
    if (!pCol) {
      pCol = {
        key: playerLabel,
        label: playerLabel,
        qtyBySize: {},
      };
      grp.playersMap.set(playerLabel, pCol);
    }
    pCol.qtyBySize[sizeUpper] = (pCol.qtyBySize[sizeUpper] ?? 0) + qty;
    grp.totalUnits += qty;
  }

  const out: SupplierOrderGroup[] = [];
  for (const grp of groupMap.values()) {
    const players = Array.from(grp.playersMap.values()).sort((a, b) => {
      if (a.label === '无印号' && b.label !== '无印号') return 1;
      if (b.label === '无印号' && a.label !== '无印号') return -1;
      const totA = Object.values(a.qtyBySize).reduce((s, n) => s + n, 0);
      const totB = Object.values(b.qtyBySize).reduce((s, n) => s + n, 0);
      if (totB !== totA) return totB - totA;
      return a.label.localeCompare(b.label);
    });

    const photoCandidates = resolveGroupPhotoCandidates(
      grp.rawModelSample,
      grp.baseModel,
      grp.version,
      state,
    );

    const sizesToRender = [
      ...STANDARD_SUPPLIER_SIZES,
      ...Array.from(grp.extraSizes).sort(),
    ];

    out.push({
      groupKey: grp.groupKey,
      team: grp.team,
      baseModel: grp.baseModel,
      rawModelSample: grp.rawModelSample,
      version: grp.version,
      chineseModelTitle: translateJerseyModelToChinese(
        grp.baseModel,
        grp.version,
        grp.team,
      ),
      defaultPatch: DEFAULT_SUPPLIER_PATCH,
      photoUrl: photoCandidates[0],
      players,
      sizesToRender,
      totalUnits: grp.totalUnits,
    });
  }

  return out;
}

interface LoadedExcelImage {
  base64: string;
  extension: 'png' | 'jpeg' | 'gif';
  width: number;
  height: number;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Invalid blob data URL'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}

function loadAndNormalizeDataUrlForExcel(
  dataUrl: string,
): Promise<LoadedExcelImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const natW = img.naturalWidth || 400;
      const natH = img.naturalHeight || 400;

      const isPng = dataUrl.startsWith('data:image/png');
      const isJpeg =
        dataUrl.startsWith('data:image/jpeg') ||
        dataUrl.startsWith('data:image/jpg');
      const isGif = dataUrl.startsWith('data:image/gif');

      if ((isPng || isJpeg || isGif) && natW <= 900 && natH <= 900) {
        resolve({
          base64: dataUrl,
          extension: isPng ? 'png' : isGif ? 'gif' : 'jpeg',
          width: natW,
          height: natH,
        });
        return;
      }

      // Convert WebP/oversized image to crisp PNG via canvas
      const maxDim = 720;
      const scale = Math.min(1, maxDim / Math.max(natW, natH));
      const targetW = Math.max(1, Math.round(natW * scale));
      const targetH = Math.max(1, Math.round(natH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const outUrl = canvas.toDataURL('image/png');
      resolve({
        base64: outUrl,
        extension: 'png',
        width: targetW,
        height: targetH,
      });
    };
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = dataUrl;
  });
}

async function fetchImageForExcel(
  candidates: string[],
  cache: Map<string, LoadedExcelImage | null>,
): Promise<LoadedExcelImage | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined') {
    return null;
  }

  for (const rawUrl of candidates) {
    if (!rawUrl) continue;
    if (cache.has(rawUrl)) {
      const cached = cache.get(rawUrl) ?? null;
      if (cached) return cached;
      continue;
    }

    try {
      let dataUrl = rawUrl;
      if (!rawUrl.startsWith('data:image/')) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 6000);
        try {
          const res = await fetch(rawUrl, {
            mode: 'cors',
            signal: controller.signal,
          });
          if (!res.ok) {
            cache.set(rawUrl, null);
            continue;
          }
          const blob = await res.blob();
          dataUrl = await blobToDataUrl(blob);
        } finally {
          window.clearTimeout(timer);
        }
      }

      const loaded = await loadAndNormalizeDataUrlForExcel(dataUrl);
      cache.set(rawUrl, loaded);
      return loaded;
    } catch {
      cache.set(rawUrl, null);
    }
  }

  return null;
}

function colIndexToLetter(col1Based: number): string {
  let n = col1Based;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const THIN_BLACK_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

function styleRange(
  ws: ExcelJS.Worksheet,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  options: {
    fillArgb?: string;
    font?: Partial<ExcelJS.Font>;
    alignment?: Partial<ExcelJS.Alignment>;
  },
) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = ws.getCell(r, c);
      cell.border = THIN_BLACK_BORDER;
      if (options.fillArgb) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: options.fillArgb },
        };
      }
      if (options.font) {
        cell.font = options.font;
      }
      if (options.alignment) {
        cell.alignment = options.alignment;
      }
    }
  }
}

export interface ExportSupplierMatrixResult {
  fileName: string;
  groupsCount: number;
  totalUnits: number;
  embeddedPhotosCount: number;
}

export async function exportSupplierOrderExcel(params: {
  lines: SupplierOrderInputLine[];
  state: AppState;
  patchByGroup: Record<string, string>;
  todayIso: string;
}): Promise<ExportSupplierMatrixResult> {
  const { lines, state, patchByGroup, todayIso } = params;
  const groups = buildSupplierOrderGroups(lines, state);
  if (groups.length === 0) {
    throw new Error('No hay ítems seleccionados con cantidad mayor a 0.');
  }

  const totalUnits = groups.reduce((s, g) => s + g.totalUnits, 0);
  const matrixPlayerCols = Math.max(
    4,
    ...groups.map((g) => g.players.length),
  );
  const lastPlayerCol = 1 + matrixPlayerCols; // Col E = 5 when 4 players
  const photoCol = lastPlayerCol + 1; // Col F = 6 when 4 players
  const patchColStart = photoCol + 1; // Col G = 7 when 4 players
  const patchColEnd = patchColStart + 1; // Col H = 8 when 4 players

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'X4SPORT';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('訂單', {
    views: [{ showGridLines: true }],
  });

  // Configurar anchos de columnas
  ws.getColumn(1).width = 16; // Col A: Tallas / 每種尺寸的數量
  for (let c = 2; c <= lastPlayerCol; c++) {
    ws.getColumn(c).width = 16; // Cols B..E: Jugadores y cantidades
  }
  ws.getColumn(photoCol).width = 28; // Col F: Foto de franela (~202px ancho)
  ws.getColumn(patchColStart).width = 13; // Col G..H: Espacio parche (~24 chars total)
  ws.getColumn(patchColEnd).width = 13;

  const imageCache = new Map<string, LoadedExcelImage | null>();
  let embeddedPhotosCount = 0;
  let currentRow = 1;

  for (const grp of groups) {
    const patchText = (patchByGroup[grp.groupKey] || grp.defaultPatch).trim();
    const sizeRowCount = grp.sizesToRender.length; // 6 por defecto (S..XXXL)
    const rHeader = currentRow; // Fila 1 del bloque
    const rMatrixTop = currentRow + 1; // Fila 2 del bloque
    const rPlayers = currentRow + 2; // Fila 3 del bloque
    const rSizesStart = currentRow + 3; // Fila 4 del bloque
    const rBlockEnd = currentRow + 2 + sizeRowCount; // Fila 9 del bloque (con 6 tallas)

    // Alturas de fila amplias (~220px+ acumulados en filas 2..9)
    ws.getRow(rHeader).height = 26;
    ws.getRow(rMatrixTop).height = 22;
    ws.getRow(rPlayers).height = 24;
    for (let r = rSizesStart; r <= rBlockEnd; r++) {
      ws.getRow(r).height = 24;
    }

    // Fila 1: A:B = 模型 | C:photoCol = Modelo en chino | patchColStart:patchColEnd = Parche en chino
    ws.mergeCells(rHeader, 1, rHeader, 2);
    ws.getCell(rHeader, 1).value = '模型';
    styleRange(ws, rHeader, 1, rHeader, 2, {
      fillArgb: 'FFF1F5F9',
      font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });

    ws.mergeCells(rHeader, 3, rHeader, photoCol);
    ws.getCell(rHeader, 3).value = grp.chineseModelTitle;
    styleRange(ws, rHeader, 3, rHeader, photoCol, {
      fillArgb: 'FFFFFFFF',
      font: { name: 'Arial', size: 12, bold: true, color: { argb: 'FF0F172A' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    });

    ws.mergeCells(rHeader, patchColStart, rHeader, patchColEnd);
    ws.getCell(rHeader, patchColStart).value = patchText;
    styleRange(ws, rHeader, patchColStart, rHeader, patchColEnd, {
      fillArgb: 'FFF8FAFC',
      font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    });

    // Zona Izquierda (Filas 2 a 9, Col A..E): Matriz Tallas y Jugadores
    ws.mergeCells(rMatrixTop, 1, rPlayers, 1);
    ws.getCell(rMatrixTop, 1).value = '每種尺寸的數量';
    styleRange(ws, rMatrixTop, 1, rPlayers, 1, {
      fillArgb: 'FFDDF3FF',
      font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0F172A' } },
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
    });

    ws.mergeCells(rMatrixTop, 2, rMatrixTop, lastPlayerCol);
    ws.getCell(rMatrixTop, 2).value = '姓名和號碼';
    styleRange(ws, rMatrixTop, 2, rMatrixTop, lastPlayerCol, {
      fillArgb: 'FFDDF3FF',
      font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
    });

    // Fila 3: Nombres y dorsales en letras latinas y números (o 无印号)
    for (let idx = 0; idx < matrixPlayerCols; idx++) {
      const col = 2 + idx;
      const p = grp.players[idx];
      ws.getCell(rPlayers, col).value = p ? p.label : '';
      styleRange(ws, rPlayers, col, rPlayers, col, {
        fillArgb: 'FFFFFFFF',
        font: { name: 'Arial', size: 10, bold: true, color: { argb: 'FF0F172A' } },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      });
    }

    // Filas 4..9: Tallas + Cantidades (blanco si 0)
    grp.sizesToRender.forEach((sizeLabel, sIdx) => {
      const r = rSizesStart + sIdx;
      ws.getCell(r, 1).value = sizeLabel;
      styleRange(ws, r, 1, r, 1, {
        fillArgb: 'FFFFFFFF',
        font: { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } },
        alignment: { horizontal: 'center', vertical: 'middle' },
      });

      for (let idx = 0; idx < matrixPlayerCols; idx++) {
        const col = 2 + idx;
        const p = grp.players[idx];
        const qty = p ? (p.qtyBySize[sizeLabel] ?? 0) : 0;
        ws.getCell(r, col).value = qty > 0 ? qty : null;
        styleRange(ws, r, col, r, col, {
          fillArgb: 'FFFFFFFF',
          font: { name: 'Arial', size: 11, bold: qty > 0, color: { argb: 'FF0F172A' } },
          alignment: { horizontal: 'center', vertical: 'middle' },
        });
      }
    });

    // Zona Central (Filas 2 a 9, Col F): Foto de la franela
    ws.mergeCells(rMatrixTop, photoCol, rBlockEnd, photoCol);
    styleRange(ws, rMatrixTop, photoCol, rBlockEnd, photoCol, {
      fillArgb: 'FFFFFFFF',
      alignment: { horizontal: 'center', vertical: 'middle' },
    });

    try {
      const photoCandidates = resolveGroupPhotoCandidates(
        grp.rawModelSample,
        grp.baseModel,
        grp.version,
        state,
      );
      const loadedImg = await fetchImageForExcel(photoCandidates, imageCache);
      if (loadedImg) {
        const imageId = workbook.addImage({
          base64: loadedImg.base64,
          extension: loadedImg.extension,
        });

        // Zona F2:F9 tiene ~202px de ancho y ~250px de alto (a 96dpi)
        const boxWidthPx = 186;
        const boxHeightPx = 224;
        const scale = Math.min(
          boxWidthPx / Math.max(1, loadedImg.width),
          boxHeightPx / Math.max(1, loadedImg.height),
        );
        const drawW = Math.max(24, Math.round(loadedImg.width * scale));
        const drawH = Math.max(24, Math.round(loadedImg.height * scale));

        // Centrar dentro de la celda combinada F2:F9 usando desplazamientos fraccionarios 0-based
        const colSpanPx = 202;
        const rowSpanPx = (22 + 24 + sizeRowCount * 24) * (96 / 72);
        const leftPadFrac = Math.max(0.04, (colSpanPx - drawW) / 2 / colSpanPx);
        const topPadRows = Math.max(
          0.1,
          ((rowSpanPx - drawH) / 2 / rowSpanPx) * (2 + sizeRowCount),
        );

        ws.addImage(imageId, {
          tl: {
            col: photoCol - 1 + leftPadFrac,
            row: rMatrixTop - 1 + topPadRows,
          },
          ext: { width: drawW, height: drawH },
          editAs: 'oneCell',
        });
        embeddedPhotosCount += 1;
      }
    } catch {
      // Si alguna imagen externa falla por CORS o formato, continuar con los demás bloques
    }

    // Zona Derecha (Filas 2 a 9, Cols G:H): Recuadro completamente limpio y listo para pegar foto del parche
    ws.mergeCells(rMatrixTop, patchColStart, rBlockEnd, patchColEnd);
    ws.getCell(rMatrixTop, patchColStart).value = null;
    styleRange(ws, rMatrixTop, patchColStart, rBlockEnd, patchColEnd, {
      fillArgb: 'FFFFFFFF',
      alignment: { horizontal: 'center', vertical: 'middle' },
    });

    // Margen de 1 fila vacía entre bloques
    const spacerRow = rBlockEnd + 1;
    ws.getRow(spacerRow).height = 14;
    currentRow = spacerRow + 1;
  }

  // Configurar vista de impresión limpia (A4 apaisada ajustada a 1 página de ancho)
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  // Nombre de archivo exacto requerido
  const unitsToken = String(totalUnits).padStart(2, '0');
  const fileName = `PD_Pedido_Proveedor_${todayIso}_${unitsToken}_單位.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);

  return {
    fileName,
    groupsCount: groups.length,
    totalUnits,
    embeddedPhotosCount,
  };
}

// Re-export column letter helper cleanly if ever inspected
export { colIndexToLetter };
