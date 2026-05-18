export enum CurrentStage {
  NOT_STARTED = 0,
  PREPARATION = 1,
  SELF_CHECK = 2,
  COUNTDOWN_5S = 3,
  FIGHTING = 4,
  SETTLEMENT = 5
}

export enum BaseStatus {
  INVINCIBLE = 0,
  VULNERABLE_ARMOR_CLOSED = 1,
  VULNERABLE_ARMOR_OPEN = 2
}

export enum OutpostStatus {
  INVINCIBLE = 0,
  ALIVE_ROTATING = 1,
  ALIVE_STOPPED = 2,
  DESTROYED_NO_REBUILD = 3,
  DESTROYED_CAN_REBUILD = 4
}

export enum EventId {
  KILL = 1,
  BASE_OUTPOST_DESTROYED = 2,
  RUNE_ACTIVATION_COUNT_CHANGE = 3,
  RUNE_UNIT_READY = 4,
  RUNE_ARMS_STATS = 5,
  RUNE_ACTIVATED = 6,
  OWN_HERO_DEPLOY = 7,
  OWN_HERO_SNIPE_DAMAGE = 8,
  ENEMY_HERO_SNIPE_DAMAGE = 9,
  OWN_AIR_SUPPORT_CALL = 10,
  OWN_AIR_SUPPORT_INTERRUPTED = 11,
  ENEMY_AIR_SUPPORT_CALL = 12,
  ENEMY_AIR_SUPPORT_INTERRUPTED = 13,
  DART_HIT = 14,
  DART_GATE_OPEN = 15,
  OWN_BASE_ATTACKED = 16,
  OUTPOST_STOP_ROTATING = 17,
  BASE_ARMOR_DEPLOY = 18
}

export enum BuffType {
  ATTACK_BOOST = 1,
  DEFENSE_BOOST = 2,
  HEAT_COOLING_BOOST = 3,
  CHASSIS_POWER_BOOST = 4,
  HEALTH_REGEN = 5,
  EXCHANGEABLE_AMMO = 6,
  TERRAIN_CROSSING = 7
}

export enum PenaltyType {
  YELLOW_CARD = 1,
  BOTH_YELLOW_CARDS = 2,
  RED_CARD = 3,
  OVER_POWER = 4,
  OVER_HEAT = 5,
  OVER_FIRE_RATE = 6
}

export enum RuneStatus {
  NOT_ACTIVATED = 1,
  ACTIVATING = 2,
  ACTIVATED = 3
}

export enum SentinelPosture {
  ATTACK = 1,
  DEFENSE = 2,
  MOVE = 3
}

export enum AirSupportStatus {
  NOT_IN_PROGRESS = 0,
  IN_PROGRESS = 1,
  LOCKED_BY_ENEMY = 2
}

export function getCurrentStageName(stage: CurrentStage): string {
  const names: Record<CurrentStage, string> = {
    [CurrentStage.NOT_STARTED]: '未开始',
    [CurrentStage.PREPARATION]: '准备阶段',
    [CurrentStage.SELF_CHECK]: '自检阶段',
    [CurrentStage.COUNTDOWN_5S]: '5秒倒计时',
    [CurrentStage.FIGHTING]: '比赛中',
    [CurrentStage.SETTLEMENT]: '结算中'
  }
  return names[stage] ?? '未知'
}

export function getBaseStatusName(status: BaseStatus): string {
  const names: Record<BaseStatus, string> = {
    [BaseStatus.INVINCIBLE]: '无敌',
    [BaseStatus.VULNERABLE_ARMOR_CLOSED]: '解除无敌（护甲未展开）',
    [BaseStatus.VULNERABLE_ARMOR_OPEN]: '解除无敌（护甲展开）'
  }
  return names[status] ?? '未知'
}

export function getOutpostStatusName(status: OutpostStatus): string {
  const names: Record<OutpostStatus, string> = {
    [OutpostStatus.INVINCIBLE]: '无敌',
    [OutpostStatus.ALIVE_ROTATING]: '存活（装甲旋转）',
    [OutpostStatus.ALIVE_STOPPED]: '存活（装甲停转）',
    [OutpostStatus.DESTROYED_NO_REBUILD]: '被击毁（不可重建）',
    [OutpostStatus.DESTROYED_CAN_REBUILD]: '被击毁（可重建）'
  }
  return names[status] ?? '未知'
}
