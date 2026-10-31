type Refresh=()=>Promise<void>;
const key=Symbol.for('teeko.classroom.connection-refresh');
const state=globalThis as typeof globalThis & {[key]?:Map<string,Set<Refresh>>};
const owners=state[key]??=new Map<string,Set<Refresh>>();

/** One Node owner today; PostgreSQL remains authoritative across the HTTP/WS bundles. */
export function subscribeClassroomRefresh(id:string,refresh:Refresh){
  let callbacks=owners.get(id);
  if(!callbacks){callbacks=new Set();owners.set(id,callbacks);}
  callbacks.add(refresh);
  return ()=>{callbacks.delete(refresh);if(!callbacks.size&&owners.get(id)===callbacks)owners.delete(id);};
}
export async function refreshClassroom(id:string){
  await Promise.allSettled([...(owners.get(id)??[])].map(refresh=>refresh()));
}
