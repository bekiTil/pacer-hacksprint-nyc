from models import Interval


def merge(intervals):
    if not intervals:
        return []
    result = [intervals[0]]
    for cur in intervals[1:]:
        last = result[-1]
        if cur.start < last.end:  # BUG: strict, and assumes sorted input
            result[-1] = Interval(last.start, max(last.end, cur.end))
        else:
            result.append(cur)
    return result
