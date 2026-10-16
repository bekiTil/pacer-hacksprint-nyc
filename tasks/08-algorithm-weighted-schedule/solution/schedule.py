import bisect


def max_profit(jobs):
    if not jobs:
        return 0
    jobs = sorted(jobs, key=lambda j: j[1])
    ends = [j[1] for j in jobs]
    dp = [0] * (len(jobs) + 1)
    for i, (start, end, profit) in enumerate(jobs, start=1):
        # last job that ends at or before this job's start
        k = bisect.bisect_right(ends, start, 0, i - 1)
        dp[i] = max(dp[i - 1], dp[k] + profit)
    return dp[len(jobs)]
