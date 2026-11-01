/** Shared camera wire limits; provider choice is owned by the authenticated classroom. */
export const CLASSROOM_VISION_MAX_BASE64 = 192000;
export const CLASSROOM_VISION_FRAME_MS = 1000;
export const CLASSROOM_VISION_MAX_WIDTH = 640;
export const CLASSROOM_VISION_MAX_HEIGHT = 480;
export const CLASSROOM_VISION_OPENAI_INTERVAL_MS = 3000;
export type ClassroomVisionState = {
 status:'off'|'starting'|'sharing'|'error'|'unavailable';
 generation:number;
 message?:string;
};
export type ClassroomVisionCommand =
 | {type:'vision.start';generation:number}
 | {type:'vision.stop';generation:number}
 | {type:'vision.frame';generation:number;sequence:number;image:string};
export type ClassroomVisionObservation = {visible:boolean;description:string};
export type ClassroomVisionObserver = (input:{image:string;contextKey:string;objective:string},signal:AbortSignal)=>Promise<ClassroomVisionObservation>;
