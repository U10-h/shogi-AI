"""Fixed KP256 layout, integer head inference and compatible model export."""
import hashlib,struct
from pathlib import Path
import numpy as np

BASE_HASH='cf7645f64bf6baa5c74612799ce562752f7985923b1f0fc2e6092c998ed867f9'
SCALE=600.0  # raw pawn90 units used only to condition optimization

def read_model(path):
    data=Path(path).read_bytes()
    assert struct.unpack_from('<II',data)==(0x7af32f16,0x5c6464a9)
    n=struct.unpack_from('<I',data,8)[0];offset=12+n
    assert struct.unpack_from('<I',data,offset)[0]==0x3f5715ff;offset+=4
    model={'bytes':data,'offsets':{},'sha256':hashlib.sha256(data).hexdigest()}
    for name,count,dtype,shape in [('ft_bias',256,'<i2',(256,)),('ft',1710*256,'<i2',(1710,256))]:
        a=np.frombuffer(data,dtype=dtype,count=count,offset=offset).copy().reshape(shape);model[name]=a;offset+=a.nbytes
    assert struct.unpack_from('<I',data,offset)[0]==0x63337156;offset+=4
    for name,count,dtype,shape in [('b1',32,'<i4',(32,)),('w1',512*32,'i1',(32,512)),('b2',32,'<i4',(32,)),('w2',1024,'i1',(32,32)),('b3',1,'<i4',(1,)),('w3',32,'i1',(32,))]:
        a=np.frombuffer(data,dtype=dtype,count=count,offset=offset).copy().reshape(shape);model[name]=a;model['offsets'][name]=(offset,dtype);offset+=a.nbytes
    assert offset==len(data)
    return model

def head_score(x,head):
    z=x.astype(np.int32)@head['w2'].astype(np.int32).T+head['b2']
    h=np.clip(z//64,0,127)
    y=h@head['w3'].astype(np.int32)+int(head['b3'][0])
    return np.clip(np.trunc(y/16),-27000,27000).astype(np.int32)

def float_head(head):
    return [head['w2'].astype(np.float64)/64,head['b2'].astype(np.float64)/(64*127),
            head['w3'].astype(np.float64)*127/(16*SCALE),head['b3'].astype(np.float64)/(16*SCALE)]

def quantize(params):
    w,b,v,c=params
    return {'w2':np.clip(np.rint(w*64),-128,127).astype(np.int8),
            'b2':np.rint(b*64*127).astype(np.int32),
            'w3':np.clip(np.rint(v*16*SCALE/127),-128,127).astype(np.int8),
            'b3':np.rint(c*16*SCALE).astype(np.int32)}

def write_head(path,head):
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(path,**{k:head[k] for k in ['w2','b2','w3','b3']},base_sha256=np.array(BASE_HASH))

def export_model(base,head,path):
    assert base['sha256']==BASE_HASH,'Wrong pretrained base'
    data=bytearray(base['bytes'])
    for name in ['b2','w2','b3','w3']:
        offset,dtype=base['offsets'][name];a=np.asarray(head[name],dtype=dtype)
        assert a.shape==base[name].shape
        data[offset:offset+a.nbytes]=a.tobytes()
    Path(path).parent.mkdir(parents=True,exist_ok=True);Path(path).write_bytes(data)
    return hashlib.sha256(data).hexdigest()

def board_key(sfen,mirror=False):
    board,side,hand,*_=sfen.split()
    if mirror:
        ranks=[]
        for row in board.split('/'):
            cells=[];promoted=''
            for c in row:
                if c.isdigit():cells+=['.']*int(c)
                elif c=='+':promoted='+'
                else:cells.append(promoted+c);promoted=''
            ranks.append(','.join(cells[::-1]))
        return '/'.join(ranks)+' '+side+' '+hand
    ranks=[]
    for row in board.split('/'):
        cells=[];promoted=''
        for c in row:
            if c.isdigit():cells+=['.']*int(c)
            elif c=='+':promoted='+'
            else:cells.append(promoted+c);promoted=''
        ranks.append(','.join(cells))
    return '/'.join(ranks)+' '+side+' '+hand

def canonical(sfen):return min(board_key(sfen),board_key(sfen,True))

def full_features(sfen,model):
    """Independent SFEN parsing, sparse FT sum, then first hidden layer."""
    board,side,hands,*_=sfen.split();pieces=[];types=' PLNSBRGK';promoted=False
    for rank,row in enumerate(board.split('/')):
        column=0
        for c in row:
            if c.isdigit():column+=int(c)
            elif c=='+':promoted=True
            else:
                pt=types.index(c.upper())+(8 if promoted else 0);promoted=False
                pieces.append((pt,0 if c.isupper() else 1,(8-column)*9+rank));column+=1
    hand=[];num=''
    for c in hands if hands!='-' else '':
        if c.isdigit():num+=c
        else:hand.append((types.index(c.upper()),0 if c.isupper() else 1,int(num or '1')));num=''
    missing=38-sum(pt!=8 for pt,_,_ in pieces)-sum(n for _,_,n in hand)
    cats=[0,0,1,2,3,5,7,4,0,4,4,4,4,6,8]
    bases=[(0,0),(1,20),(39,44),(49,54),(59,64),(79,82),(85,88),(69,74)]
    acc=[]
    for perspective in [0,1]:
        ids=[(1548 if pt==8 else 90+162*cats[pt])+(81 if color!=perspective else 0)+(sq if perspective==0 else 80-sq) for pt,color,sq in pieces]
        ids += [bases[pt][int(color!=perspective)]+i for pt,color,n in hand for i in range(n)]
        v=model['ft_bias'].astype(np.int32)+model['ft'][ids].astype(np.int32).sum(axis=0)+missing*model['ft'][0].astype(np.int32)
        acc.append(((v+32768)%65536-32768).astype(np.int32))
    stm=0 if side=='b' else 1;x=np.clip(np.concatenate([acc[stm],acc[1-stm]]),0,127)
    h1=np.clip((model['w1'].astype(np.int32)@x+model['b1'])//64,0,127).astype(np.uint8)
    return h1
