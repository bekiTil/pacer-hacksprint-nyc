def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            return (seen[need], i)
        seen[n] = i
    return None
