<script setup>
import { useRouteHead } from '../../composables/useRouteHead'
import { useI18n } from '../../composables/useI18n'
import ImageShell from './ImageShell.vue'
const { meta: m } = useRouteHead()
const { t } = useI18n()
</script>
<template>
  <ImageShell wide :h1="m.h1" :title="t('img2.inv.title')" :sub="t('img2.inv.sub')">
    <p class="ctrl">{{ t('img2.inv.robustNote') }}</p>
  </ImageShell>
</template>
