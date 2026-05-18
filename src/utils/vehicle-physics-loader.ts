/**
 * 车辆物理配置加载器
 * 读取 resources/VehiclePhysics/*.xml 并解析为可用参数
 */

export interface VehiclePhysicsConfig {
  id: string
  name: string
  base: {
    mass: number
    chassisSize: { width: number; height: number; length: number }
    description: string
  }
  motor: {
    power: number
    torque: number
    maxRPM: number
    powerPercent: number
  }
  suspension: {
    stiffness: number
    damping: number
    compression: number
    restLength: number
    maxTravel: number
  }
  wheels: {
    radius: number
    friction: number
    rollInfluence: number
  }
  damping: {
    linear: number
    angular: number
  }
  control: {
    turnSensitivity: number
    maxSpeed: number
  }
  gimbal: {
    yawMin: number
    yawMax: number
    pitchMin: number
    pitchMax: number
    rollMin: number
    rollMax: number
    mouseSensitivity: number
  }
}

/**
 * 解析 XML 配置文件
 */
export function parseVehiclePhysicsXML(xmlString: string): VehiclePhysicsConfig {
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml')

  const root = xmlDoc.documentElement
  const id = root.getAttribute('id') || 'unknown'
  const name = root.getAttribute('name') || 'Unknown Vehicle'

  // 辅助函数：获取节点文本内容并转换为数字
  const getNum = (selector: string): number => {
    const node = root.querySelector(selector)
    return node ? parseFloat(node.textContent || '0') : 0
  }

  // 辅助函数：获取文本内容
  const getText = (selector: string): string => {
    const node = root.querySelector(selector)
    return node?.textContent || ''
  }

  return {
    id,
    name,
    base: {
      mass: getNum('Base > mass'),
      chassisSize: {
        width: parseFloat(root.querySelector('Base > chassisSize')?.getAttribute('width') || '0'),
        height: parseFloat(root.querySelector('Base > chassisSize')?.getAttribute('height') || '0'),
        length: parseFloat(root.querySelector('Base > chassisSize')?.getAttribute('length') || '0')
      },
      description: getText('Base > description')
    },
    motor: {
      power: getNum('Motor > power'),
      torque: getNum('Motor > torque'),
      maxRPM: getNum('Motor > maxRPM'),
      powerPercent: getNum('Motor > powerPercent')
    },
    suspension: {
      stiffness: getNum('Suspension > stiffness'),
      damping: getNum('Suspension > damping'),
      compression: getNum('Suspension > compression'),
      restLength: getNum('Suspension > restLength'),
      maxTravel: getNum('Suspension > maxTravel')
    },
    wheels: {
      radius: getNum('Wheels > radius'),
      friction: getNum('Wheels > friction'),
      rollInfluence: getNum('Wheels > rollInfluence')
    },
    damping: {
      linear: getNum('Damping > linear'),
      angular: getNum('Damping > angular')
    },
    control: {
      turnSensitivity: getNum('Control > turnSensitivity'),
      maxSpeed: getNum('Control > maxSpeed')
    },
    gimbal: {
      yawMin: getNum('Gimbal > yawMin'),
      yawMax: getNum('Gimbal > yawMax'),
      pitchMin: getNum('Gimbal > pitchMin'),
      pitchMax: getNum('Gimbal > pitchMax'),
      rollMin: getNum('Gimbal > rollMin'),
      rollMax: getNum('Gimbal > rollMax'),
      mouseSensitivity: getNum('Gimbal > mouseSensitivity')
    }
  }
}

/**
 * 从主进程加载 XML 配置
 */
export async function loadVehiclePhysicsConfig(vehicleId: string): Promise<VehiclePhysicsConfig> {
  // 通过 IPC 调用主进程读取文件
  if (!window.api?.readVehiclePhysicsConfig) {
    throw new Error('API readVehiclePhysicsConfig not available')
  }

  const xmlString = await window.api.readVehiclePhysicsConfig(vehicleId)
  return parseVehiclePhysicsXML(xmlString)
}

/**
 * 获取所有可用的车辆配置列表
 */
export async function listVehiclePhysicsConfigs(): Promise<Array<{ id: string; name: string }>> {
  if (!window.api?.listVehiclePhysicsConfigs) {
    throw new Error('API listVehiclePhysicsConfigs not available')
  }

  return await window.api.listVehiclePhysicsConfigs()
}

/**
 * 转换配置为物理引擎参数格式
 */
export function convertToPhysicsParams(config: VehiclePhysicsConfig): Record<string, number> {
  return {
    vehicleMass: config.base.mass,
    motorPower: config.motor.power,
    motorTorque: config.motor.torque,
    powerPercent: config.motor.powerPercent,
    suspensionStiffness: config.suspension.stiffness,
    suspensionDamping: config.suspension.damping,
    suspensionCompression: config.suspension.compression,
    suspensionRestLength: config.suspension.restLength,
    maxSuspensionTravel: config.suspension.maxTravel,
    wheelRadius: config.wheels.radius,
    wheelFriction: config.wheels.friction,
    rollInfluence: config.wheels.rollInfluence,
    linearDamping: config.damping.linear,
    angularDamping: config.damping.angular,
    turnSensitivity: config.control.turnSensitivity
  }
}
