'use client';

import { use } from 'react';
import { Classroom, type VoiceFactory } from '../../../components/product/classroom';
import { ClassroomVoiceClient } from '../../../lib/classroom-voice-client';
import '../../../components/product/product.css';
import '../../../components/product/classroom.css';

const createVoice: VoiceFactory = options => new ClassroomVoiceClient(options);
export default function ClassroomPage({params}:{params:Promise<{id:string}>}){
 const {id}=use(params);
 return <Classroom classroomId={id} voiceFactory={createVoice}/>;
}
