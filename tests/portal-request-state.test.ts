import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'
import { usePortalRequest } from '../components/usePortalRequest'

describe('Portal request ownership', () => {
  it('lets only the latest request publish a terminal result', () => {
    const scope = effectScope()
    const request = scope.run(() => usePortalRequest())!
    expect(request.state.value.kind).toBe('idle')
    const earlier = request.begin()!
    const latest = request.begin()!

    expect(request.pending.value).toBe(true)
    expect(request.isCurrent(earlier)).toBe(false)
    expect(request.succeed(earlier)).toBe(false)
    expect(request.pending.value).toBe(true)
    expect(request.isCurrent(latest)).toBe(true)
    expect(request.succeed(latest)).toBe(true)
    expect(request.state.value.kind).toBe('success')
    expect(request.pending.value).toBe(false)
    expect(request.fail(latest)).toBe(false)
    scope.stop()
  })

  it('permits retry after failure without accepting the failed request again', () => {
    const scope = effectScope()
    const request = scope.run(() => usePortalRequest())!
    const failed = request.begin()!
    expect(request.fail(failed)).toBe(true)
    expect(request.state.value.kind).toBe('error')

    const retry = request.begin()!
    expect(request.succeed(failed)).toBe(false)
    expect(request.fail(failed)).toBe(false)
    expect(request.isCurrent(retry)).toBe(true)
    expect(request.succeed(retry)).toBe(true)
    scope.stop()
  })

  it('invalidates context immediately while permitting a replacement request', () => {
    const scope = effectScope()
    const request = scope.run(() => usePortalRequest())!
    const previousContext = request.begin()!
    request.invalidate()
    expect(request.state.value.kind).toBe('idle')
    expect(request.isCurrent(previousContext)).toBe(false)
    expect(request.fail(previousContext)).toBe(false)

    const replacement = request.begin()!
    expect(request.isCurrent(replacement)).toBe(true)
    expect(request.succeed(previousContext)).toBe(false)
    expect(request.succeed(replacement)).toBe(true)
    scope.stop()
  })

  it('rejects all settlement and new work after its Vue scope is disposed', () => {
    const scope = effectScope()
    const request = scope.run(() => usePortalRequest())!
    const pending = request.begin()!
    scope.stop()

    expect(request.state.value.kind).toBe('disposed')
    expect(request.pending.value).toBe(false)
    expect(request.succeed(pending)).toBe(false)
    expect(request.fail(pending)).toBe(false)
    expect(request.begin()).toBeNull()
    request.invalidate()
    expect(request.state.value.kind).toBe('disposed')
  })

  it('keeps independent request lanes from accepting one another tokens', () => {
    const scope = effectScope()
    const lanes = scope.run(() => ({ load: usePortalRequest(), save: usePortalRequest() }))!
    const loading = lanes.load.begin()!
    const saving = lanes.save.begin()!

    expect(lanes.load.succeed(saving)).toBe(false)
    expect(lanes.save.fail(loading)).toBe(false)
    expect(lanes.load.isCurrent(loading)).toBe(true)
    expect(lanes.save.isCurrent(saving)).toBe(true)
    scope.stop()
  })
})
