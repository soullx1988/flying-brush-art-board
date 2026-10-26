export interface ProjectRecord {
  navigation?: import('./project-navigation.js').ProjectNavigation
  id: string
  title: string
  rootBoardId: string
  formatVersion: number
  automationTag?: string
  createdAt: string
  updatedAt: string
}
