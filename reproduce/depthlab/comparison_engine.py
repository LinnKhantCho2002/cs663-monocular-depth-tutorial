"""Native model adapters with strict weight verification and common image size.

V2 and AC share an inference architecture; the AC checkpoint includes one
unused 1x1 geometric-prior layer, which is registered and loaded explicitly.
DA3 uses its official core network and input processor without optional 3D
export dependencies. Its shared LayerNorm parameters are loaded via safetensors'
shared-parameter-aware loader. No inference weights remain randomly initialized.
"""
import json
import sys
import time
import cv2
import numpy as np
import torch
from depthlab.engine import Prediction,select_device,synchronize
from depthlab.model_registry import CODE,MODELS


class ComparisonEngine:
    def __init__(self,key,device="auto"):
        self.key=key
        self.spec=MODELS[key]
        self.device=select_device(device)
        start=time.perf_counter()
        if key in {"v2","ac"}:
            sys.path.insert(0,str(CODE["v2"]["path"]))
            from depth_anything_v2.dpt import DepthAnythingV2
            self.model=DepthAnythingV2(encoder="vits",features=64,out_channels=[48,96,192,384])
            if key=="ac":
                self.model.geo_prior_gen=torch.nn.Conv2d(1,2,kernel_size=1,bias=False)
            state=torch.load(self.spec["path"]/self.spec["file"],weights_only=True,map_location="cpu")
            self.model.load_state_dict(state,strict=True)
            self.native_semantics="relative inverse depth; higher = closer"
        elif key=="da3":
            sys.path.insert(0,str(CODE["da3"]["path"]/"src"))
            from depth_anything_3.cfg import create_object
            from depth_anything_3.utils.io.input_processor import InputProcessor
            from omegaconf import OmegaConf
            from safetensors.torch import load_model
            config=json.loads((self.spec["path"]/"config.json").read_text())["config"]
            self.model=create_object(OmegaConf.create(config))
            wrapper=torch.nn.Module()
            wrapper.model=self.model
            load_model(wrapper,str(self.spec["path"]/self.spec["file"]),strict=True)
            self.processor=InputProcessor()
            self.native_semantics="relative depth from main DA3-Small; lower = closer; not the metric checkpoint"
        self.model.to(self.device).eval()
        synchronize(self.device)
        self.load_seconds=time.perf_counter()-start

    def predict(self,image,input_size=518):
        synchronize(self.device)
        start=time.perf_counter()
        with torch.inference_mode():
            if self.key in {"v2","ac"}:
                # Native V2 processor uses OpenCV and patch-divisible lower-bound resizing.
                bgr=cv2.cvtColor(np.asarray(image),cv2.COLOR_RGB2BGR)
                inputs,_=self.model.image2tensor(bgr,input_size)
                inputs=inputs.to(self.device)
                native=self.model(inputs)
                shape=tuple(inputs.shape)
                inverse=torch.nn.functional.interpolate(native[:,None],size=(image.height,image.width),
                                                         mode="bilinear",align_corners=True)[0,0]
            else:
                inputs,_,_=self.processor([image],process_res=input_size,
                                           process_res_method="lower_bound_resize",sequential=True)
                if inputs.ndim==4:
                    inputs=inputs.unsqueeze(0)
                inputs=inputs.to(self.device)
                shape=tuple(inputs.shape)
                result=self.model(inputs,infer_gs=False,use_ray_pose=False)
                native=result["depth"][0,0]
                # Upsample native depth first, then invert. Do not treat DA3 depth
                # as disparity or use a metric scale absent from this checkpoint.
                depth=torch.nn.functional.interpolate(native[None,None],size=(image.height,image.width),
                                                       mode="bilinear",align_corners=True)[0,0]
                inverse=1.0/depth.clamp_min(1e-6)
            raw=inverse.float().cpu().numpy()
        synchronize(self.device)
        seconds=time.perf_counter()-start
        if raw.shape!=(image.height,image.width) or not np.isfinite(raw).all():
            raise ValueError("Invalid native model output.")
        return Prediction(raw,seconds,shape,self.device)

    def metadata(self):
        return {"model_key":self.key,"label":self.spec["label"],"model_id":self.spec["id"],
                "model_revision":self.spec["revision"],"parameters":sum(p.numel() for p in self.model.parameters()),
                "device":self.device,"torch":torch.__version__,"dtype":"float32",
                "model_load_seconds":self.load_seconds,"native_semantics":self.native_semantics,
                "common_output_semantics":"relative inverse depth; higher = closer; not meters",
                "resize_policy":"518 short-edge target, preserve aspect ratio, multiples of 14; native rounding differs slightly",
                "code_revision":CODE["da3" if self.key=="da3" else "v2"]["revision"],
                "weight_loading":"strict, all inference parameters loaded; DA3 shared weights resolved by safetensors",
                "adapter_note":("AC checkpoint's unused geo_prior_gen is loaded; native V2 inference architecture and preprocessing used for both V2 and AC" if self.key=="ac" else
                                "DA3 official core + input processor, float32, single view, no known cameras or 3D export" if self.key=="da3" else "Official native V2 implementation"),
                "license":self.spec["license"]}
