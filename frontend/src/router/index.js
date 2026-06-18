import { createRouter, createWebHistory } from "vue-router"
import Home from "../views/Home.vue"
import Recipe from '../views/Recipe.vue'
import History from '../views/History.vue'
import LiveCamera from '../views/LiveCamera.vue'

const routes = [

{
 path:"/",
 redirect:"/home"
},

{
 path:"/home",
 component:Home
},

{
 path:"/recipe",
 component:Recipe
},

{
 path:"/history",
 component:History
},

{
 path:"/live",
 component:LiveCamera
}

]

const router = createRouter({
 history:createWebHistory(),
 routes
})

export default router