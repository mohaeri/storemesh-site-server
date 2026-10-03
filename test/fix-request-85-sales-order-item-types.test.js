import test from'node:test';
import assert from'node:assert/strict';
import{randomUUID}from'node:crypto';
import{StoreMesh}from'../src/domain.js';
import{PostgresRepository}from'../src/postgres-repository.js';

const key=()=>randomUUID();

test('duplicate sales-order package types are rejected and never persist',{skip:!process.env.DATABASE_URL},async()=>{const site=`FR85-${Date.now()}`,repository=new PostgresRepository({connectionString:process.env.DATABASE_URL,siteCode:site});try{const app=new StoreMesh({site,initialState:await repository.load(),seedDemoReferences:true});app.repository=repository;const customer=app.createCustomer({code:'FR85-C',name:'Duplicate type customer'},key());assert.throws(()=>app.createSalesOrder({customerId:customer.id,items:[{packageType:'CARTON',quantity:5},{packageType:'CARTON',quantity:10}]},key()),error=>error.code==='SALES_ORDER_ITEM_TYPE_DUPLICATE');await app.flush();assert.equal((await repository.load()).salesOrders.length,0)}finally{await repository.close()}});

test('legacy duplicate item types are blocked at shipment creation and shipping',()=>{const app=new StoreMesh(),order={id:key(),customerId:key(),status:'OPEN',items:[{packageType:'CARTON',quantity:5},{packageType:'CARTON',quantity:10}]};app.state.salesOrders.push(order);assert.throws(()=>app.createShipment({salesOrderId:order.id,packageIds:[key()]},key()),error=>error.code==='SALES_ORDER_ITEM_TYPE_DUPLICATE');const shipment={id:key(),salesOrderId:order.id,customerId:order.customerId,status:'LOADED',packageIds:[],shippingBoxIds:[]};app.state.shipments.push(shipment);assert.throws(()=>app.updateShipment(shipment.id,'SHIP',{},key()),error=>error.code==='SALES_ORDER_ITEM_TYPE_DUPLICATE');assert.equal(shipment.status,'LOADED')});
