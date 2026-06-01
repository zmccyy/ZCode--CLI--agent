export type DeepImmutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepImmutable<U>[]
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
      : T extends Set<infer U>
        ? ReadonlySet<DeepImmutable<U>>
        : T extends object
          ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
          : T

export type Permutations<T, U = T> = [T] extends [never]
  ? readonly []
  : readonly [T, ...Exclude<U, T>[]]
