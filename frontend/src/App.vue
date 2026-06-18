<template>

<div class="layout">

  <Sidebar/>

  <div class="content">
    <router-view/>
  </div>

</div>

</template>

<script setup>
import Sidebar from "./components/Sidebar.vue"
</script>

<style>

.layout{
 display:flex;
 margin: -8px;
}

.content{
 flex:1;
}

</style>