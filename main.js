import { Actor } from 'apify';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';

await Actor.init();
const input=await Actor.getInput()||{};
const {apiId,apiHash,sessionString,source,limit=1000,onlyWithUsername=false,excludeBots=true,includeDeleted=false}=input;
if(!apiId||!apiHash||!sessionString||!source) throw new Error('apiId, apiHash, sessionString and source are required.');

const client=new TelegramClient(new StringSession(sessionString),Number(apiId),apiHash,{connectionRetries:5,autoReconnect:true});
const startedAt=Date.now();
let collected=0,skipped=0;

try{
  await client.connect();
  const entity=await client.getEntity(source);
  const entityId=entity?.id?.toString?.()??null;
  await Actor.pushData({recordType:'run_info',source:String(source),resolvedEntityId:entityId,startedAt:new Date(startedAt).toISOString()});

  let offset=0;
  const pageSize=200;

  while(collected<Number(limit)){
    const batchLimit=Math.min(pageSize,Number(limit)-collected);
    let result;

    if(entity.className==='Channel'){
      result=await client.invoke(new Api.channels.GetParticipants({
        channel:entity,
        filter:new Api.ChannelParticipantsSearch({q:''}),
        offset,limit:batchLimit,hash:0
      }));
    }else{
      result=await client.invoke(new Api.channels.GetParticipants({
        channel:entity,
        filter:new Api.ChannelParticipantsRecent(),
        offset,limit:batchLimit,hash:0
      }));
    }

    const users=result?.users||[];
    if(!users.length) break;

    for(const user of users){
      if(!includeDeleted&&user.deleted){skipped++;continue;}
      if(excludeBots&&user.bot){skipped++;continue;}
      if(onlyWithUsername&&!user.username){skipped++;continue;}

      await Actor.pushData({
        recordType:'user',
        user_id:user.id?.toString?.()??null,
        username:user.username??null,
        first_name:user.firstName??null,
        last_name:user.lastName??null,
        phone:user.phone??null,
        is_bot:Boolean(user.bot),
        is_deleted:Boolean(user.deleted),
        source:String(source),
        source_entity_id:entityId
      });
      collected++;
      if(collected>=Number(limit)) break;
    }

    if(users.length<batchLimit) break;
    offset+=users.length;
    await Actor.setStatusMessage(`Collected ${collected}/${limit} | skipped ${skipped}`);
    await new Promise(r=>setTimeout(r,700));
  }

  await Actor.pushData({recordType:'summary',source:String(source),collected,skipped,durationSeconds:Math.round((Date.now()-startedAt)/1000)});
  await Actor.setStatusMessage(`Finished: ${collected} users collected.`);
}catch(error){
  await Actor.pushData({recordType:'error',error:error?.message||String(error)});
  throw error;
}finally{
  await client.disconnect().catch(()=>{});
  await Actor.exit();
}
