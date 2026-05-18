<template>
  <div class="viewport-frame">
    <!-- 左上角 - 直角线条 -->
    <div class="corner corner-tl">
      <div class="line-horizontal"></div>
      <div class="line-vertical"></div>
    </div>

    <!-- 右上角 - 直角线条 -->
    <div class="corner corner-tr">
      <div class="line-horizontal"></div>
      <div class="line-vertical"></div>
    </div>

    <!-- 左下角 - 直角线条 -->
    <div class="corner corner-bl">
      <div class="line-horizontal"></div>
      <div class="line-vertical"></div>
    </div>

    <!-- 右下角 - 直角线条 -->
    <div class="corner corner-br">
      <div class="line-horizontal"></div>
      <div class="line-vertical"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
// 视野边框组件 - 直角线条风格
</script>

<style scoped>
.viewport-frame {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

.corner {
  position: absolute;
}

.line-horizontal,
.line-vertical {
  position: absolute;
  background: linear-gradient(
    to right,
    rgba(255, 255, 255, 0.25),
    rgba(255, 255, 255, 0.15),
    rgba(255, 255, 255, 0.08)
  );
}

.line-horizontal {
  height: 2px;
  width: 120px;
}

.line-vertical {
  width: 2px;
  height: 100px;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.25),
    rgba(255, 255, 255, 0.15),
    rgba(255, 255, 255, 0.08)
  );
}

/* 左上角 */
.corner-tl {
  top: 12%;
  left: 10%;
}

.corner-tl .line-horizontal {
  top: 0;
  left: 0;
}

.corner-tl .line-vertical {
  top: 0;
  left: 0;
}

/* 右上角 */
.corner-tr {
  top: 12%;
  right: 10%;
}

.corner-tr .line-horizontal {
  top: 0;
  right: 0;
  background: linear-gradient(
    to left,
    rgba(255, 255, 255, 0.25),
    rgba(255, 255, 255, 0.15),
    rgba(255, 255, 255, 0.08)
  );
}

.corner-tr .line-vertical {
  top: 0;
  right: 0;
}

/* 左下角 */
.corner-bl {
  bottom: 12%;
  left: 10%;
}

.corner-bl .line-horizontal {
  bottom: 0;
  left: 0;
}

.corner-bl .line-vertical {
  bottom: 0;
  left: 0;
  background: linear-gradient(
    to top,
    rgba(255, 255, 255, 0.25),
    rgba(255, 255, 255, 0.15),
    rgba(255, 255, 255, 0.08)
  );
}

/* 右下角 */
.corner-br {
  bottom: 12%;
  right: 10%;
}

.corner-br .line-horizontal {
  bottom: 0;
  right: 0;
  background: linear-gradient(
    to left,
    rgba(255, 255, 255, 0.25),
    rgba(255, 255, 255, 0.15),
    rgba(255, 255, 255, 0.08)
  );
}

.corner-br .line-vertical {
  bottom: 0;
  right: 0;
  background: linear-gradient(
    to top,
    rgba(255, 255, 255, 0.25),
    rgba(255, 255, 255, 0.15),
    rgba(255, 255, 255, 0.08)
  );
}
</style>
