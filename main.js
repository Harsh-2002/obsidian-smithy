/*
firstfinger-publisher — minimal CMS inside Obsidian for Hugo blogs.
Built artifact — do not edit directly.
Source: https://github.com/Harsh-2002/obsidian-firstfinger-publisher
*/
var s=Object.defineProperty;var t=Object.getOwnPropertyDescriptor;var d=Object.getOwnPropertyNames;var p=Object.prototype.hasOwnProperty;var u=(l,o)=>{for(var a in o)s(l,a,{get:o[a],enumerable:!0})},c=(l,o,a,r)=>{if(o&&typeof o=="object"||typeof o=="function")for(let n of d(o))!p.call(l,n)&&n!==a&&s(l,n,{get:()=>o[n],enumerable:!(r=t(o,n))||r.enumerable});return l};var f=l=>c(s({},"__esModule",{value:!0}),l);var g={};u(g,{default:()=>e});module.exports=f(g);var i=require("obsidian"),e=class extends i.Plugin{async onload(){console.log("[firstfinger-publisher] onload"),this.app.workspace.onLayoutReady(()=>{console.log("[firstfinger-publisher] layout ready")})}async onunload(){console.log("[firstfinger-publisher] onunload")}};
