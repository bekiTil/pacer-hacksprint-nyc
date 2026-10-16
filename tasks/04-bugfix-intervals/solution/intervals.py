from models import Interval


def merge(intervals):
    if not intervals:
        return []
    ordered = sorted(intervals, key=lambda iv: iv.start)
    result = [ordered[0]]
    for cur in ordered[1:]:
        last = result[-1]
        if cur.start <= last.end:
            result[-1] = Interval(last.start, max(last.end, cur.end))
        else:
            result.append(cur)
    return result
