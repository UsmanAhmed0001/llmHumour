import { jaccard, uniqueRatio, avgConsecutiveJaccard, computeDuplicates, verdictFor } from "../lib/analytics.ts";
import { clampTemp } from "../lib/models.ts";

let pass = 0, fail = 0;
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name); }
}

// uniqueRatio
check("uniqueRatio 3 distinct of 5 = 0.6", approx(uniqueRatio(["a","a","a","b","c"])!, 0.6));
check("uniqueRatio identical pair = 0.5", approx(uniqueRatio(["x","x"])!, 0.5));
check("uniqueRatio empty = null", uniqueRatio([]) === null);
check("uniqueRatio single = 1", approx(uniqueRatio(["only"])!, 1));
check("uniqueRatio trims whitespace", approx(uniqueRatio(["joke ", "joke"])!, 0.5));

// jaccard
check("jaccard identical = 1", approx(jaccard("why did the scarecrow win","why did the scarecrow win"), 1));
check("jaccard half overlap = 0.5", approx(jaccard("the cat sat","the dog sat"), 0.5));
check("jaccard disjoint = 0", approx(jaccard("abc","xyz"), 0));
check("jaccard both empty = 1", approx(jaccard("",""), 1));
check("jaccard ignores punctuation/case", approx(jaccard("Hello, world!","hello world"), 1));

// avgConsecutiveJaccard
check("avgConsecJaccard [catcat,dog] ~0.667", approx(avgConsecutiveJaccard(["the cat","the cat","the dog"])!, (1 + 1/3) / 2));
check("avgConsecJaccard single = null", avgConsecutiveJaccard(["x"]) === null);

// computeDuplicates
const dups = computeDuplicates([{key:0,text:"A"},{key:1,text:"A"},{key:2,text:"B"}]);
check("dups: run0 and run1 grouped", dups.has(0) && dups.has(1));
check("dups: run2 unique (absent)", !dups.has(2));
check("dups: same groupId", dups.get(0)!.groupId === dups.get(1)!.groupId);
check("dups: size = 2", dups.get(0)!.size === 2);
const dups2 = computeDuplicates([{key:0,text:"A"},{key:1,text:"B"},{key:2,text:"A"},{key:3,text:"B"}]);
check("dups: two distinct groups", dups2.get(0)!.groupId !== dups2.get(1)!.groupId);

// verdictFor
check("verdict 0.9 good", verdictFor(0.9)!.tone === "good");
check("verdict 0.6 mixed", verdictFor(0.6)!.tone === "mixed");
check("verdict 0.3 bad", verdictFor(0.3)!.tone === "bad");
check("verdict null", verdictFor(null) === null);

// clampTemp
check("clamp anthropic 1.8 -> 1", approx(clampTemp("anthropic", 1.8), 1));
check("clamp openai 1.8 -> 1.8", approx(clampTemp("openai", 1.8), 1.8));
check("clamp google 2 -> 2", approx(clampTemp("google", 2), 2));
check("clamp negative -> 0", approx(clampTemp("openai", -1), 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
