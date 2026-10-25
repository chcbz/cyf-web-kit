/** Request readback scheduling only. Identity, HTTP and business projections belong to the caller. */
export const createHallRequestReadbackScheduler = ({
  read, captureGuard, isCurrent, isActiveRequest, setTimeout, clearTimeout, debounceMs
}) => {
  const jobs = new Map()
  const inflight = new Map()
  let epoch = 0
  let disposed = false

  const valid = (id, guard) => !disposed && typeof id === 'string' && Boolean(id) && isCurrent(guard)
  const readNow = (id, guard = captureGuard()) => {
    if (!valid(id, guard)) return Promise.resolve(false)
    const existing = inflight.get(id)
    if (existing) return existing
    const generation = epoch
    const promise = (async () => read(id, guard))()
    inflight.set(id, promise)
    const settle = () => {
      if (epoch === generation && inflight.get(id) === promise) inflight.delete(id)
    }
    void promise.then(settle, settle)
    return promise
  }

  const run = (id, job) => {
    // An old timer must not delete a replacement job for the same request after reset.
    if (jobs.get(id) !== job) return
    if (job.epoch !== epoch || !valid(id, job.guard) || !isActiveRequest(id)) {
      jobs.delete(id)
      return
    }
    if (job.inFlight) return
    job.timer = null
    job.deltaDirty = false
    const pending = readNow(id, job.guard)
    job.inFlight = pending
    const settle = () => {
      if (job.epoch !== epoch || jobs.get(id) !== job || job.inFlight !== pending) return
      job.inFlight = null
      const immediate = job.forceTrailingImmediate
      const dirty = job.deltaDirty
      job.forceTrailingImmediate = false
      job.deltaDirty = false
      if (!valid(id, job.guard) || !isActiveRequest(id)) {
        jobs.delete(id)
      } else if (immediate) {
        Promise.resolve().then(() => run(id, job))
      } else if (dirty) {
        job.timer = setTimeout(() => run(id, job), debounceMs)
      } else {
        jobs.delete(id)
      }
    }
    void pending.then(settle, settle)
  }

  const schedule = (id, { immediate = false } = {}) => {
    if (disposed || typeof id !== 'string' || !id || !isActiveRequest(id)) return false
    const guard = captureGuard()
    if (!isCurrent(guard)) return false
    let job = jobs.get(id)
    if (!job) {
      job = { timer: null, inFlight: null, forceTrailingImmediate: false, deltaDirty: false, guard, epoch }
      jobs.set(id, job)
    } else {
      job.guard = guard
    }
    if (immediate) {
      if (job.timer != null) clearTimeout(job.timer)
      job.timer = null
      job.deltaDirty = false
      if (job.inFlight || inflight.has(id)) job.forceTrailingImmediate = true
      if (!job.inFlight) run(id, job)
    } else {
      job.deltaDirty = true
      if (job.inFlight) return true
      if (job.timer != null) clearTimeout(job.timer)
      job.timer = setTimeout(() => run(id, job), debounceMs)
    }
    return true
  }

  const reset = () => {
    epoch += 1
    for (const job of jobs.values()) {
      if (job.timer != null) clearTimeout(job.timer)
    }
    jobs.clear()
    inflight.clear()
  }
  const dispose = () => {
    disposed = true
    reset()
  }

  return { readNow, schedule, hasInFlight: id => inflight.has(id), reset, dispose }
}
