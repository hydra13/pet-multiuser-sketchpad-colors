
import { precision } from './wglPrecision.js'

/**
struct point {
	int16_t x, y;
	struct color {
		uint8_t r,g,b,a;
	};
	uint16_t pointWidth;
	uint8_t uv[2];
}
*/
const STRIDE = 12
export class PointsBuffer {
	constructor(maxNumPoints) {
		this.maxNumPoints = maxNumPoints
		this.stride = STRIDE

		this.ab = new ArrayBuffer( this.maxNumPoints * this.stride * 6 )

		this.i8array  = new Uint8Array(this.ab)
		this.u8array  = new Uint8Array(this.ab)
		this.i16array = new Int16Array(this.ab)
		this.u16array = new Uint16Array(this.ab)
		this.f32array = new Float32Array(this.ab)
		
		this.writeIndex = 0
		
		const rectPositions = [
			[0   ,  0xFF], [0xFF,  0xFF],
			[0xFF, 0    ], [0   , 0    ],
		];
		const _rectPositions = [
			[-1,  1], [ 1,  1],
			[ 1, -1], [-1, -1],
		]
		this.uvs = [
			0,1,2, 
			0,2,3,
		]
			.map(i => rectPositions[i])
			.flat(1e9)
			
		console.log( this.uvs )
		console.log( this.ab.byteLength )
	}
	
	canWrite() {
		return this.writeIndex < this.maxNumPoints
	}

	writePoint(x, y, r, g, b, a, pointWidth) {
		if ( !this.canWrite() )
			return false

		const stride = this.stride
		const u8 = this.u8array
		const i16 = this.i16array
		const u16 = this.u16array
		const f32 = this.f32array
		
		let offset = this.writeIndex++ * 6 * stride
		
		const uvs = this.uvs
		for(let i = 0; i < uvs.length; i += 2) {
			i16[ ((offset +  0) >> 1) + 0 ] = Math.round(x * 8)
			i16[ ((offset +  0) >> 1) + 1 ] = Math.round(y * 8)
			u8 [ ((offset +  4) >> 0) + 0 ] = r
			u8 [ ((offset +  4) >> 0) + 1 ] = g
			u8 [ ((offset +  4) >> 0) + 2 ] = b
			u8 [ ((offset +  4) >> 0) + 3 ] = a
			u16[ ((offset +  8) >> 1) + 0 ] = pointWidth

			u8 [ ((offset + 10) >> 0) + 0 ] = uvs[i+0]
			u8 [ ((offset + 10) >> 0) + 1 ] = uvs[i+1]

			offset += stride
		}

		return true
	}

	getWriteData() {
		return this.u8array.subarray(0, this.writeIndex * this.stride * 6)
	}
	
	reset() {
		this.writeIndex = 0
	}
}
export class DrawPoints {
	constructor(wgl) {
		this.wgl = wgl
	
		this.program = this.wgl.createProgram(
		`precision ${precision} float;

		attribute vec2  aPos;
		attribute vec4  aColor;
		attribute float aWidth;
		attribute vec2  aUV;

		varying vec2  vUV;
		varying vec4  vColor;
		
		uniform vec2 uViewSize;

		void main(void) {
			vec2 screenSizeD2 = uViewSize / 2.0;
			
			float width = (aWidth*2.0) / 2.0;
			
			vUV = aUV;
			vUV = vUV * vec2(2, 2) - vec2(1, 1);
			
			gl_Position = vec4(
				(aPos / vec2(8, 8) + (vUV * width)) / screenSizeD2,
				0, 
				1
			);

			vColor = aColor;
		}
		`, 
		`precision ${precision} float;
		varying vec2  vUV;
		varying vec4  vColor;

		void main(void) {
			const float radius = 0.5;
			float len = length(vUV);

			float a = (radius - len) / radius;
			a = 1.0;
			
			float d1 = len - radius;

			gl_FragColor = vColor;
				
			if ( len < radius ) {
				a = 1.0;//gl_FragColor = vColor;
			} else {
				//gl_FragColor = vec4(vColor.rgb, 0.0);
				//if ( d1 > radius )
				
				//discard;
				
				a = (radius - d1) / (radius);
			}
			
			gl_FragColor[3] *= a;
			//gl_FragColor = vec4(vec3(1,0,0), a);
			
		}`)

		this.maxNumPoints = 16 * 1024
		this.pointsBufferList = []
		this.addPointsBuffer()
		
		this.glBuffer = this.wgl.createBuffer()
		this.glBuffer.bindBuffer().bufferData( this.getWritePointsBuffer().ab.byteLength, this.wgl.gl.DYNAMIC_DRAW )
		
		const rectPositions = [
			[-1,  1], [ 1,  1],
			[ 1, -1], [-1, -1],
		]
		this.glBufferVertexMesh = this.wgl.createBuffer()
		this.glBufferVertexMesh.bindBuffer().bufferData(new Float32Array(
			[	
				0,1,2, 
				0,2,3,
			]
				.map(i => rectPositions[i])
				.flat(1e9)
		))		
		
	}
	addPointsBuffer() {
		this.pointsBufferList.push(new PointsBuffer(this.maxNumPoints))
	}
	getWritePointsBuffer() {
		while(1) {
			const pb = this.pointsBufferList[ this.pointsBufferList.length - 1 ]
			if ( pb.canWrite() )
				return pb

			this.addPointsBuffer()
		}
	}

	addPoint(x, y, r, g, b, a, pointWidth) {
		this.getWritePointsBuffer().writePoint( x, y, r, g, b, a, pointWidth )
	}
	
	drawPointsBuffer(pointsBuffer) {
		const gl = this.wgl.gl

		const data = pointsBuffer.getWriteData()
		if ( !data.length )
			return
		
		this.glBuffer.bindBuffer().bufferSubData(data)
		const stride = STRIDE
		this.program.aPos  .pointer({ size: 2, type: gl.SHORT         , stride, offset:  0, normalized: false })
		this.program.aColor.pointer({ size: 4, type: gl.UNSIGNED_BYTE , stride, offset:  4, normalized: true  })
		this.program.aWidth.pointer({ size: 1, type: gl.UNSIGNED_SHORT, stride, offset:  8, normalized: false })
		this.program.aUV   .pointer({ size: 2, type: gl.UNSIGNED_BYTE , stride, offset: 10, normalized: true  })
		
		this.wgl.gl.drawArrays(gl.TRIANGLES, 0, pointsBuffer.writeIndex*6)
	}
	draw() {
		const program = this.program
		
		gl.enable( gl.BLEND )
		gl.blendEquation( gl.FUNC_ADD )
		gl.blendFunc( gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA )
		
		program.useProgram()
		program.enableVertexAttribArrayAll()
		
		program.uViewSize.uniform2f(this.wgl.viewWidth, this.wgl.viewHeight)

		for(const pointsBuffer of this.pointsBufferList)
			this.drawPointsBuffer(pointsBuffer)
		this.reset()
		
		program.disableVertexAttribArrayAll()
		
		gl.disable( gl.BLEND )
	}

	reset() {
		this.pointsBufferList = [this.pointsBufferList.pop()]
		this.getWritePointsBuffer().reset()
	}

	delete() {
		this.glBuffer.delete()
		this.glBufferVertexMesh.delete()
	}
}
