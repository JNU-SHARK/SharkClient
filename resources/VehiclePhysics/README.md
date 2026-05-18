# 车辆物理系统配置模板

本目录包含所有车辆类型的物理参数配置文件。

## 📁 配置文件

| 文件           | 车型       | 质量 | 功率 | 特性         |
| -------------- | ---------- | ---- | ---- | ------------ |
| `infantry.xml` | 步兵机器人 | 15kg | 120W | 全能平衡型   |
| `hero.xml`     | 英雄机器人 | 25kg | 180W | 高防护高火力 |
| `sentry.xml`   | 哨兵机器人 | 12kg | 100W | 快速反应型   |
| `engineer.xml` | 工程机器人 | 20kg | 150W | 负重运输型   |
| `drone.xml`    | 空中机器人 | 3kg  | 60W  | 极速侦察型   |

## 🎯 用途

- 定义不同机器人型号的物理特性
- 麦克纳姆轮配置（轮半径、摩擦力）
- 电机性能参数（功率、扭矩）
- 悬挂系统调节（刚度、阻尼）
- 云台运动限制（Yaw/Pitch 范围）

## 📖 使用指南

详见：`docs/VEHICLE_CONFIG_USAGE.md`

## 🔧 加载器

- **TypeScript 加载器**：`src/renderer/src/utils/vehicle-physics-loader.ts`
- **主进程 IPC**：`src/main/index.ts`（vehicle-physics:read/list）

## 🎨 XML 结构

```xml
<VehiclePhysics id="..." name="...">
  <Base>...</Base>
  <Motor>...</Motor>
  <Suspension>...</Suspension>
  <Wheels>...</Wheels>
  <Damping>...</Damping>
  <Control>...</Control>
  <Gimbal>...</Gimbal>
</VehiclePhysics>
```

## 🚀 快速开始

```typescript
import { loadVehiclePhysicsConfig } from '@renderer/utils/vehicle-physics-loader'

const config = await loadVehiclePhysicsConfig('infantry')
console.log(config.name) // "步兵机器人"
```

---

**文档版本**：v1.0  
**最后更新**：2025-12-04
