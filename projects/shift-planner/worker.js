import {solve} from './solver.js';
self.onmessage = ({data}) => {
  try { self.postMessage({result: solve(data.input, {timeLimitMs: data.input.settings.timeLimitMs, referenceSchedule: data.referenceSchedule})}); }
  catch (error) { self.postMessage({error: error.message || '探索中にエラーが発生しました。'}); }
};
