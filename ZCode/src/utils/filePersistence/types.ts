export const OUTPUTS_SUBDIR = 'outputs'

export const FILE_COUNT_LIMIT = 1_000

export const DEFAULT_UPLOAD_CONCURRENCY = 8

export type TurnStartTime = number

export type PersistedFile = {
  filename: string
  fileId: string
}

export type FailedPersistence = {
  filename: string
  error: string
}

export type FilesPersistedEventData = {
  files: PersistedFile[]
  failed: FailedPersistence[]
}
