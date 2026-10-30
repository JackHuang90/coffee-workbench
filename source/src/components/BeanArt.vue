<script setup lang="ts">
defineProps<{ small?: boolean }>();
</script>
<template>
  <svg v-if="!small" viewBox="0 0 260 190" fill="none" aria-hidden="true" class="botanical">
    <path d="M43 159C76 123 112 90 147 30" stroke="#9a9d7d" stroke-width="1.4" />
    <path d="M106 96C71 99 66 77 68 57C96 56 108 73 106 96Z" fill="#cbd1b7" stroke="#aeb79b" />
    <path
      d="M115 84C139 59 161 64 177 76C164 100 137 103 115 84Z"
      fill="#d5dac4"
      stroke="#aeb79b"
    />
    <path d="M141 42C121 24 133 8 145 3C162 17 159 30 141 42Z" fill="#cbd1b7" stroke="#aeb79b" />
    <path d="M133 56C147 32 171 35 183 44C176 63 154 68 133 56Z" fill="#cbd1b7" stroke="#aeb79b" />
    <path d="M74 129C46 131 42 110 50 94C74 99 84 112 74 129Z" fill="#d5dac4" stroke="#aeb79b" />
    <path
      d="M83 120C101 93 125 102 135 114C125 133 103 138 83 120Z"
      fill="#cbd1b7"
      stroke="#aeb79b"
    />
    <g fill="#bc8f74">
      <circle cx="108" cy="89" r="4" />
      <circle cx="113" cy="94" r="4" />
      <circle cx="79" cy="126" r="4" />
      <circle cx="84" cy="131" r="4" />
    </g>
    <g transform="translate(185 119) rotate(-28)">
      <ellipse rx="8" ry="11" fill="#b88462" />
      <path d="M1-9C-5-2 5 2-1 9" stroke="#f6ebdb" />
    </g>
    <g transform="translate(211 146) rotate(35)">
      <ellipse rx="6" ry="8" fill="#a96d4b" />
      <path d="M1-6C-4-2 3 2-1 6" stroke="#f6ebdb" />
    </g>
    <g transform="translate(180 161) rotate(22)">
      <ellipse rx="4.5" ry="6" fill="#cfa27e" />
      <path d="M1-5C-2-1 2 1-1 5" stroke="#f6ebdb" />
    </g>
    <path d="M40 171C87 182 129 175 166 161" stroke="#ded1be" />
  </svg>
  <svg v-else viewBox="0 0 32 40" fill="none" aria-hidden="true">
    <ellipse cx="16" cy="20" rx="11" ry="16" transform="rotate(28 16 20)" fill="currentColor" />
    <path d="M21 8C10 14 22 24 11 32" stroke="#f8f4eb" stroke-width="1.5" />
  </svg>
</template>
