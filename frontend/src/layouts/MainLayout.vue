<template>

<div class="layout">

  <Sidebar/>

  <div class="content">
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component"/>
      </keep-alive>
    </router-view>
  </div>

</div>

</template>

<script setup>
import Sidebar from "../components/Sidebar.vue"
</script>

<style>

.layout{
 display:flex;
 height:100vh;
}

.content{
 flex:1;
 padding:20px;
 background:#f5f6f7;
}

</style>