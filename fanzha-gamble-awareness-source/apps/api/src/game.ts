import { randomInt } from 'node:crypto';

export const SYMBOLS = ['🀄', '發', '中', '八萬', '●●', '竹', '元宝', '警盾'] as const;

export type ReelGrid = string[][];

function randomSymbol() {
  return SYMBOLS[randomInt(0, SYMBOLS.length)]!;
}

export function makeOutcome(spinCount: number, scriptedMode: boolean): { reels: ReelGrid; multiplier: number; scripted: boolean } {
  const reels: ReelGrid = Array.from({ length: 5 }, () => Array.from({ length: 3 }, randomSymbol));

  // 教学脚本必须在前台明确标注，目的是展示诈骗平台可以操纵输赢。
  if (scriptedMode && spinCount === 1) {
    const symbol = '中';
    for (let column = 0; column < 5; column += 1) reels[column]![1] = symbol;
    return { reels, multiplier: 5, scripted: true };
  }
  if (scriptedMode && spinCount === 2) {
    const symbol = '發';
    for (let column = 0; column < 3; column += 1) reels[column]![1] = symbol;
    return { reels, multiplier: 2, scripted: true };
  }
  if (scriptedMode && spinCount >= 4) {
    const losingLine = ['中', '發', '八萬', '竹', '元宝'];
    for (let column = 0; column < 5; column += 1) reels[column]![1] = losingLine[column]!;
    return { reels, multiplier: 0, scripted: true };
  }

  const middle = reels.map((column) => column[1]);
  const same = middle.filter((symbol) => symbol === middle[0]).length;
  const multiplier = same >= 5 ? 5 : same >= 4 ? 3 : same >= 3 ? 2 : 0;
  return { reels, multiplier, scripted: false };
}

export function payoutFor(stake: number, multiplier: number) {
  return stake * multiplier;
}
