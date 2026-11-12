import { computed, onScopeDispose, shallowRef } from 'vue'

export type PortalRequestToken = Readonly<{ id: symbol }>

export type PortalRequestState =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'pending'; token: PortalRequestToken }>
  | Readonly<{ kind: 'success' }>
  | Readonly<{ kind: 'error' }>
  | Readonly<{ kind: 'disposed' }>

/** Owns one request lane; panels retain their own evidence and feedback policies. */
export const usePortalRequest = () => {
  const current = shallowRef<PortalRequestState>({ kind: 'idle' })
  const state = computed(() => current.value)
  const pending = computed(() => current.value.kind === 'pending')

  const begin = (): PortalRequestToken | null => {
    if (current.value.kind === 'disposed') return null
    const token: PortalRequestToken = { id: Symbol('portal-request') }
    current.value = { kind: 'pending', token }
    return token
  }

  const isCurrent = (token: PortalRequestToken): boolean =>
    current.value.kind === 'pending' && current.value.token === token

  const settle = (token: PortalRequestToken, kind: 'success' | 'error'): boolean => {
    if (!isCurrent(token)) return false
    current.value = { kind }
    return true
  }

  const succeed = (token: PortalRequestToken): boolean => settle(token, 'success')
  const fail = (token: PortalRequestToken): boolean => settle(token, 'error')
  const invalidate = (): void => {
    if (current.value.kind !== 'disposed') current.value = { kind: 'idle' }
  }

  onScopeDispose(() => { current.value = { kind: 'disposed' } })

  return { state, pending, begin, isCurrent, succeed, fail, invalidate }
}
