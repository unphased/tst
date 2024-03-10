import { test } from "../index.js";
import { Statistics, hrTimeMs } from "ts-utils";
import { MinHeap } from "../min-heap.js";

export const min_heap = test('minheap', ({ p, l, a: { eq, eqO } }) => {
  type N = { n: number; s?: string; };
  const minHeap = new MinHeap<N>('n');
  minHeap.insert({ n: 12 });
  minHeap.insert({ n: 10 });
  minHeap.insert({ n: 100 });
  minHeap.insert({ n: 5 });
  eqO(minHeap.extractMin(), { n: 5 });
  eqO(minHeap.extractMin(), { n: 10 });
  eqO(minHeap.extractMin(), { n: 12 });
  eqO(minHeap.extractMin(), { n: 100 });
  eq(minHeap.extractMin(), undefined);

  const sizes: number[] = [];
  const perf_ratio: number[] = [];
  const sort_times: number[] = [];
  const heap_insert_times: number[] = [];
  const heap_extract_times: number[] = [];

  for (let i = 0; i < 50; i++) {
    const len = Math.round(Math.random() * ((i % 4 === 0) ? 400 : 20000) + 5);
    const random = Array.from({ length: len }, () => ({ n: Math.random() * 1000 }));
    // perform many operations to ensure the heap is working as intended
    const random_to_sort = random.slice();
    const start = process.hrtime();
    const sorted = random_to_sort.sort((a, b) => a.n - b.n);
    const sort_time = process.hrtime(start);

    const heap = new MinHeap<N>('n');
    const start_heap_insert = process.hrtime();
    for (const i of random) { heap.insert(i); }
    const heap_insert_time = process.hrtime(start_heap_insert);
    const heap_sorted: typeof random = [];
    const start_heap_extract = process.hrtime();
    for (let i = 0; i < len; i++) {
      const min = heap.extractMin();
      if (min) heap_sorted.push(min);
    }
    const heap_extract_time = process.hrtime(start_heap_extract);
    eq(len, random.length);
    eq(random.length, heap_sorted.length);
    eq(random.length, sorted.length);
    eqO(heap_sorted, sorted);
    sizes.push(len);
    perf_ratio.push(hrTimeMs(sort_time) / (hrTimeMs(heap_insert_time) + hrTimeMs(heap_extract_time)));
    sort_times.push(hrTimeMs(sort_time));
    heap_insert_times.push(hrTimeMs(heap_insert_time));
    heap_extract_times.push(hrTimeMs(heap_extract_time));
  }

  const plot = [{
    title: 'Sort over heap time',
    y_axes: ['sort_heap_ratio_time', 'sort_time', 'heap_insert_time', 'heap_extract_time'],
    data: [sizes, perf_ratio, sort_times, heap_insert_times, heap_extract_times]
  }];
  l(plot);
  p('uplot', plot);
});
// this gives me good confidence in the floor(random()) approach for integer random number generation

export const basic_random_dice_roll = test('math', ({ l, p, a: { gt, lt } }) => {
  const dice = Array.from({ length: 1000000 }, () => Math.floor(Math.random() * 6));
  const title = 'Dice roll 1M render stress test';
  p('uplot', [{
    title,
    y_axes: ['die value'],
    data: [Array.from({ length: 1000000 }, (_, i) => i), dice]
  }], title);
  const stats = new Statistics(dice);
  const mean = stats.mean();
  const variance = stats.variance();
  l('mean', mean);
  l('variance', variance);
  // var approaches 17.5/6 =~ 2.9167
  gt(variance, 2.9);
  lt(variance, 2.93);
  // mean approaches 2.5
  gt(mean, 2.48);
  lt(mean, 2.52);
});

export const min_heap_with_greedy_scheduling_usage = test('minheap', ({ l, t, p }) => {
  // usage example modeled after my use case. bunch of stuff to distribute into buckets greedily
  // arranged in a way such that jobs do not need to be cloned.
  // All random job order tests come first, then sorting makes it the bad order, then reverse from then on will flip it each time
  // between that and the good order.
  const procedures = [
    { useMinHeap: false, sort: false, reverse: false, desc: 'random job order into random buckets' },
    { useMinHeap: true, sort: false, reverse: false, desc: 'random job order into the lightest bucket' },
    { useMinHeap: false, sort: true, reverse: true, desc: 'good job order into random buckets' },
    { useMinHeap: true, sort: true, reverse: false, desc: 'bad job order into the lightest bucket' },
    { useMinHeap: true, sort: true, reverse: true, desc: 'good job order into the lightest bucket' },
  ];
  // there is no need to test bad job order into random buckets since we should be able to show
  // with the two above that job order makes no difference if inserting into random bucket.
  const numIters = 100;
  const subplots_name = 'bucket distributions';
  const res = Array.from({ length: numIters }, (_, i) => i).map(i => {
    const minHeap = new MinHeap<{ n: number; }>('n');
    const bucketCount = Math.round(Math.random() * 20) + 3;
    const buckets = Array.from({ length: bucketCount }, () => ({ n: Math.round(Math.random() * 10) }));
    const buckets_str = JSON.stringify(buckets);
    const jobCount = Math.round(Math.random() * 80) + 40;
    const jobs = Array.from({ length: jobCount }, () => ({ size: (Math.random() ** 4) * 100 }));

    const final_buckets_by_p = procedures.map((proc) => {
      const bucks = JSON.parse(buckets_str) as typeof buckets; // prevent mutation of buckets value
      if (proc.useMinHeap) {
        minHeap.clear();
        for (const bucket of bucks) {
          minHeap.insert(bucket);
        }
      }
      if (proc.sort) {
        jobs.sort((a, b) => a.size - b.size);
      }
      if (proc.reverse) {
        jobs.reverse();
      }
      for (const job of jobs) {
        let bucket: (typeof bucks)[0] | undefined;
        if (proc.useMinHeap) {
          bucket = minHeap.extractMin();
        } else {
          bucket = bucks[Math.floor(Math.random() * bucks.length)];
        }
        if (!bucket) { throw 'failed to index to a bucket'; }
        bucket.n += job.size;
        if (proc.useMinHeap) {
          minHeap.insert(bucket);
        }
      }
      const b = bucks.map(e => e.n);
      return { stats: new Statistics(b), final_state: b };
    });
    p('uplot', [{
      title: `bucket distributions for run ${i}`,
      id: 'buckets' + i,
      y_axes: ['starting state', ...procedures.map(p => 'final state ' + p.desc)],
      data: [Array.from({ length: bucketCount }, (_, i) => i), buckets.map(e => e.n), ...final_buckets_by_p.map(bp => bp.final_state)]
    }, {
        title: `job distribution for run ${i}`,
        id: 'jobs' + i,
        y_axes: ['job size'],
        data: [Array.from({ length: jobCount }, (_, i) => i), jobs.map(e => e.size)]
      }], subplots_name);
    return { final_buckets_by_p, jobs, i };
  });

  type VoidTakingMethodsOf<T> = {
    [P in keyof T]: T[P] extends () => unknown ? P : never;
  }[keyof T];

  const statMethods: VoidTakingMethodsOf<Statistics>[] = ['max', 'variance', 'standardDeviation'];

  const slice_and_dice = procedures.map(
    (p, pi) => ({
      results: res.map(
        r => ({
          stats: Object.fromEntries(statMethods.map(method => [
            method,
            r.final_buckets_by_p[pi].stats[method]() as number
          ])), jobs: r.jobs
        })
      ), procedure: p.desc
    })
  );

  const sorted_runs_by_joblen = res.slice().sort((a, b) => a.jobs.length - b.jobs.length);
  p('uplot', statMethods.map((method, mi) => ({
    title: `${method} in final bucket sizes, across runs sorted by job count`,
    id: 'srbjc' + mi,
    clickNavMapX: sorted_runs_by_joblen.map((r) => 'buckets' + r.i),
    targetNavGroupId: subplots_name,
    y_axes: procedures.map(p => `bucket ${method} via ${p.desc}`),
    data: [Array.from({ length: numIters }, (_, i) => i), ...procedures.map((p, pi) => sorted_runs_by_joblen.map(e => e.final_buckets_by_p[pi].stats[method]() as number))]
  })), 'distribution stats');

  const sorted_runs_by_total_work = res.slice().sort((a, b) => a.final_buckets_by_p[4].stats.max() - b.final_buckets_by_p[4].stats.max());
  p('uplot', statMethods.map((method, mi) => ({
    title: `${method} in final bucket sizes, across runs sorted by average bucket load`,
    id: 'srbj' + mi,
    clickNavMapX: sorted_runs_by_total_work.map((r) => 'buckets' + r.i),
    targetNavGroupId: subplots_name,
    y_axes: procedures.map(p => `bucket ${method} via ${p.desc}`),
    data: [Array.from({ length: numIters }, (_, i) => i), ...procedures.map((p, pi) => sorted_runs_by_total_work.map(e => e.final_buckets_by_p[pi].stats[method]() as number))]
  })), 'distribution stats');

  // l(slice_and_dice.map(procs => ({ s: procs.results.map(res => ({ ...res.stats, buckets: res.buckets.length, jobs: res.jobs.length })) , p: procs.procedure })));
  // can do some graphing at this point...
  const results = slice_and_dice.map(procs => ({ proc: procs.procedure, s: new Statistics(procs.results.map(res => res.stats.standardDeviation)) }));
  l(Object.fromEntries(statMethods.map(method => [method, Object.fromEntries(results.map(r => [`stddev of buckets assembled from ${r.proc}`, r.s[method]()]))])));

  // l(slice_and_dice[4]);
  t('exemptFromAsserting', true);
  // // these second order stats are a bit gnarly.
  // // variance of unsorted should be higher than variance of proper sorting
  // gt(results[0].mean(), results[2].mean());
  // // variance of worst sorting should be higher than that of unsorted.
  // gt(results[1].mean(), results[0].mean());
  // const improvement = results[0].mean() / results[2].mean();
  // l('improvement', improvement);
  // // variance of proper scheduling with smallest items last into the lightest bucket, should be at least 10 times smaller than that of scheduling jobs randomly into the
  // // lightest bucket. Varies greatly with the choice of populations up above.
  // gt(improvement, 10);
  //
  // // gnarly alert: we check the variance across runs of the variance values. This one asserts that sorting the
  // // jobs in the worst way for scheduling will produce a smaller variance in the high value of variance seen (compared
  // // to random picking scheduling.)
  // lt(results[1].variance(), results[0].variance());
});

