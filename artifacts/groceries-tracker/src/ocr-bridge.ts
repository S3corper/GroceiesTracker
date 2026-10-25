import { scanOnDevice } from '@workspace/api-client-react/device-ocr';
declare global { interface Window { ReactNativeWebView?: { postMessage(message:string):void }; groceryScan?: (id:string,body:any)=>Promise<void> } }
let busy=false;
window.groceryScan=async(id,body)=>{
  if(busy){ window.ReactNativeWebView?.postMessage(JSON.stringify({id,error:'Another scan is still running.'})); return; }
  busy=true;
  try{ const result=await scanOnDevice(body); window.ReactNativeWebView?.postMessage(JSON.stringify({id,result})); }
  catch(error){ window.ReactNativeWebView?.postMessage(JSON.stringify({id,error:error instanceof Error?error.message:'Receipt scan failed.'})); }
  finally{busy=false;}
};
window.ReactNativeWebView?.postMessage(JSON.stringify({ready:true}));
