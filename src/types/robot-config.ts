export type RobotTypeConfig = {
  customDataProto?: string
}

export type RobotMapping = {
  type: string
  team: string
  number: number
  id: number
}

export type RobotConfigFile = {
  robotTypes?: Record<string, RobotTypeConfig>
  robotMappings?: Record<string, RobotMapping>
}

export type RobotConfigResult = {
  type?: string
  team?: string
  number?: number
  id?: number
  customDataProto?: string
}
