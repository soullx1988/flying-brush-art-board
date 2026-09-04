export interface ProjectRecord {
  id: string
  title: string
  rootBoardId: string
  formatVersion: number
  automationTag?: string
  /** New projects are owner-scoped. Absence denotes a legacy shared project. */
  ownerOpenId?: string
  createdAt: string
  updatedAt: string
}
