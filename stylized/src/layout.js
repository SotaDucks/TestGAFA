// 场地布局：所有模块共享的尺寸常量（单位：米）
export const SITE = {
  podiumY: 2.4, // 平台（架空层地面）标高
  podiumFront: 6.4, // 平台前沿 z
  stepH: 0.15,
  stepD: 0.36,
  nSteps: 15,
  stairsHalf: 10, // 大台阶 x ∈ [-10, 10]
  planterHalf: 1.6, // 中间花池 x ∈ [-1.6, 1.6]
  cheekW: 0.45,
  plaza: { x0: -32, x1: 32, z0: 6.4, z1: 40 },
  B: {
    x0: -17,
    x1: 17,
    bays: 8,
    zF: 0, // 外廊柱列
    zW: -2.6, // 教室窗墙
    zG: -8, // 首层围合墙
    zB: -13, // 背立面
    gH: 4.5, // 架空层层高
    fH: 3.6, // 标准层层高
    floors: 3,
    slabT: 0.38,
    parH: 1.05,
  },
  banyan: { x: -12.6, z: 3.3 },
};

SITE.stairsEnd = SITE.podiumFront + SITE.nSteps * SITE.stepD; // 11.8

// 第 k 层楼板顶面标高（k = 1..floors+1，floors+1 为屋面）
export function slabTop(k) {
  const B = SITE.B;
  return SITE.podiumY + B.gH + (k - 1) * B.fH;
}

export function bayX(i) {
  const B = SITE.B;
  return B.x0 + (i * (B.x1 - B.x0)) / B.bays;
}

// 台阶第 i 级（0 为最下一级）的踏面标高与 z 范围
export function stepInfo(i) {
  const top = (i + 1) * SITE.stepH;
  const zFront = SITE.podiumFront + (SITE.nSteps - i) * SITE.stepD;
  const zBack = zFront - SITE.stepD;
  return { top, zFront, zBack };
}

export function onStairs(x, z) {
  return Math.abs(x) <= SITE.stairsHalf && z > SITE.podiumFront && z < SITE.stairsEnd;
}

export function inPlanter(x, z) {
  return Math.abs(x) < SITE.planterHalf && z > SITE.podiumFront && z < SITE.stairsEnd;
}

// 地面高度（不含建筑本体）
export function groundY(x, z) {
  if (z <= SITE.podiumFront && Math.abs(x) < 45) return SITE.podiumY;
  if (onStairs(x, z)) {
    const k = Math.floor((z - SITE.podiumFront) / SITE.stepD);
    const y = (SITE.nSteps - k) * SITE.stepH;
    if (inPlanter(x, z)) return y + 0.38;
    return y;
  }
  return 0;
}
