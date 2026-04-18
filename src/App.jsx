import React, { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, Center, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import Webspaceship from './Webspaceship';
import './App.css';

window.spaceshipShift = false;
window.spaceshipBoost = 0; // 0 to 1
window.spaceshipMoving = false; // tracked by Webspaceship

function CameraController({ orbitRef }) {
  const { camera } = useThree();
  useFrame(() => {
    if (window.spaceshipMoving || window.spaceshipShift) {
       // Smoothly snap the camera to the optimal game viewing angle (Behind ship, looking forward into deep space)
       camera.position.lerp(new THREE.Vector3(0, 3, 12), 0.05);
       if (orbitRef.current) {
         orbitRef.current.target.lerp(new THREE.Vector3(0, 0, -20), 0.05);
       }
    }
  });
  return null;
}

function Asteroids() {
  const meshRef = useRef();
  const count = 50; // Total asteroids in pool
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const [positions, rotations] = useMemo(() => {
    const pos = [];
    const rot = [];
    for (let i=0; i<count; i++) {
       pos.push(
         (Math.random() - 0.5) * 25, // x spread (closer to flight path)
         (Math.random() - 0.5) * 15, // y spread
         -50 - Math.random() * 100 // z starts deep in negative space
       );
       rot.push(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    }
    return [pos, rot];
  }, []);

  useFrame((state, delta) => {
    // Asteroids move faster when boosting
    const speed = 15 + (window.spaceshipBoost * 25);
    for (let i = 0; i < count; i++) {
       positions[i*3 + 2] += speed * delta; // Fly TOWARDS the camera (+Z)
       
       // Tumble rotation
       rotations[i*3] += delta * 0.5;
       rotations[i*3 + 1] += delta * 0.5;

       // If asteroid flies completely past the camera (+Z > 15), reset it to deep space
       if (positions[i*3 + 2] > 15) {
          positions[i*3 + 2] = -80 - Math.random() * 50;
          positions[i*3] = (Math.random() - 0.5) * 25; // keep closer to center
          positions[i*3 + 1] = (Math.random() - 0.5) * 15;
       }

       dummy.position.set(positions[i*3], positions[i*3+1], positions[i*3+2]);
       dummy.rotation.set(rotations[i*3], rotations[i*3+1], rotations[i*3+2]);
       
       // Add some random size variety
       const scale = 0.5 + (i % 4) * 0.5; 
       dummy.scale.set(scale, scale, scale);
       dummy.updateMatrix();
       meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#3a3a3a" roughness={0.9} />
    </instancedMesh>
  );
}

function MovingStars() {
  const starsRef = useRef();
  const count = 1000;
  
  // Create random star positions
  const [positions, speeds] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const spd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60; // x
      pos[i * 3 + 1] = (Math.random() - 0.5) * 60; // y
      pos[i * 3 + 2] = -60 + (Math.random() * 90); // start deep into negative Z up to +30
      spd[i] = Math.random() * 2 + 1; // random speed multiplier
    }
    return [pos, spd];
  }, [count]);

  useFrame((state, delta) => {
    // Handle global boost state interpolation
    if (window.spaceshipShift) {
      window.spaceshipBoost += delta / 1.0; // Takes 1s to reach full boost
      if (window.spaceshipBoost > 1) window.spaceshipBoost = 1;
    } else {
      window.spaceshipBoost -= delta / 3.0; // Takes 3s to slow down
      if (window.spaceshipBoost < 0) window.spaceshipBoost = 0;
    }

    // Normal speed is ~7, boosts up to 17
    const currentSpeed = 7 + (window.spaceshipBoost * 10);

    // Stars move towards +Z (Flying towards the camera)
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3 + 2] += speeds[i] * delta * currentSpeed;

      // Infinite loop: if they go completely passed the camera (+30), teleport them deep into negative Z
      if (positions[i3 + 2] > 30) {
        positions[i3 + 2] = -60;
      }
    }
    if (starsRef.current) {
      starsRef.current.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <points ref={starsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial size={0.1} color="#ffffff" transparent opacity={0.6} sizeAttenuation={true} />
    </points>
  );
}

function App() {
  const orbitRef = useRef();

  return (
    <div className="canvas-container">
      <Canvas camera={{ position: [0, 3, 12], fov: 45 }}>
        <color attach="background" args={['#050508']} />
        
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[-10, 5, -10]} intensity={0.8} color="#e94560" />
        
        <Suspense fallback={null}>
          <Center>
            <Webspaceship scale={0.5} />
          </Center>
          <ContactShadows position={[0, -2.5, 0]} opacity={0.7} scale={20} blur={2.5} far={4} />
          
          <MovingStars />
          <Asteroids />
          <Environment preset="night" />
        </Suspense>

        {/* Full Controls for the 3D scene (Rotate, Pan, Zoom) */}
        <OrbitControls ref={orbitRef} enableZoom={true} enablePan={true} autoRotate={false} />
      </Canvas>
    </div>
  );
}

export default App;
