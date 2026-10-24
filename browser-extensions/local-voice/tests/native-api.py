from typing import Optional
import importlib.util, tempfile, wave, os
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
spec=importlib.util.spec_from_file_location('facade',Path(__file__).resolve().parents[1] / 'adapters' / 'openai_speech_api.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Input(BaseModel):
 character:str
 text:str
 speed_factor:float=1
 request_id:Optional[str]=None
voices=[{'id':'a','name':'角色甲'}];calls=[]
async def listing():return {'characters':voices}
async def generate(request):calls.append(request);return {'audio_url':'/audio/test.wav'}
with tempfile.TemporaryDirectory(prefix='native-speech-test-') as directory:
 with wave.open(str(Path(directory)/'test.wav'),'wb') as output:
  output.setnchannels(1);output.setsampwidth(2);output.setframerate(16000);output.writeframes(bytes(16000))
 app=FastAPI();m.register(app,listing,generate,Input,Path(directory),os.environ.get('FFMPEG_PATH', 'ffmpeg'));client=TestClient(app)
 assert client.get('/v1/models').status_code==200
 assert client.get('/v1/audio/voices').json()['voices']==voices
 voices.append({'id':'b','name':'角色乙'});assert len(client.get('/v1/audio/voices').json()['voices'])==2
 r=client.post('/v1/audio/speech',json={'input':'你好','voice':'角色甲','response_format':'wav','speed':1.2,'request_id':'test-request'});assert r.status_code==200 and r.content[:4]==b'RIFF';assert calls[-1].character=='a' and calls[-1].speed_factor==1.2 and calls[-1].request_id=='test-request'
 r=client.post('/v1/audio/speech',json={'input':'你好','voice':'b','response_format':'mp3'});assert r.status_code==200 and len(r.content)>100 and r.headers['content-type']=='audio/mpeg'
 n=len(calls)
 for data in [{'input':'x'*501,'voice':'a'},{'input':'你好','voice':'missing'},{'input':'你好','voice':'a','model':'wrong'},{'input':'你好','voice':'a','speed':5}]:assert client.post('/v1/audio/speech',json=data).status_code in (400,422)
 assert len(calls)==n
print('PASS original generate reuse, dynamic voices, WAV/MP3, speed/request ID forwarding, invalid input rejected before synthesis')
