<template>

<div class="sidebar">
  <router-link to="/home" class="menu-item">{{ t('navHome') }}</router-link>
  <router-link to="/recipe" class="menu-item">{{ t('navRecipe') }}</router-link>
  <router-link to="/live" class="menu-item">{{ t('navLive') }}</router-link>
  <router-link to="/history" class="menu-item">{{ t('navHistory') }}</router-link>
</div>

</template>

<script setup>
import { useLangStore } from '../stores/lang'
const { t } = useLangStore()
</script>

<style scoped>

.sidebar{
 width:180px;
 height:120vh;
 background:#fff;
 display:flex;
 flex-direction:column;
 gap:20px;
 padding-top: 25px;
 padding-right: 8px;
 border-color: #333;
 padding-left: 8px;
 border-right: 1px solid #ccc;
}

.logo{
 font-weight:bold;
 margin-bottom:20px;
}

.menu-item{
 text-decoration:none;
 color:#333;
 background: rgb(246, 248, 250);
 height:70px;
 display:flex;
 align-items:center;
 justify-content:center;
 text-align:center;
 border:2px solid #cfcfcf;
 font-size:18px;
 white-space:nowrap;
}

/* hover */
.menu-item:hover{
 background:#dcdcdc;
}

/* active tab */
.router-link-active{
 background: rgb(221, 244, 255);
 border:3px solid rgb(9, 105, 218);
 color:rgb(9, 105, 218);
 border-left-width: 6px;
}

</style>