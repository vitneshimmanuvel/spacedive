import React, { Suspense, useRef, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, OrbitControls, Center, ContactShadows, useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import Webspaceship from './Webspaceship';
import './App.css';

window.spaceshipShift = false;
window.spaceshipBoost = 0; // 0 to 1
window.spaceshipMoving = false; // tracked by Webspaceship
window.spaceshipPosition = { x: 0, y: 0, z: 0 };
window.spaceshipCollider = { x: 0, y: 0, z: 0, radius: 0.3 };
window.gameOver = false;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

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

function RockObstacles({ gameOver, onHitRock }) {
  const count = 30; // Increased count since space is larger now
  const shipWorldPoint = useMemo(() => new THREE.Vector3(), []);
  const previousShipPoint = useRef(new THREE.Vector3());
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const rockTexture = useTexture('/asteroid_texture.png');
  
  const rocks = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      // random size in different axes to make different sizes and shapes
      const sizeX = 0.8 + Math.random() * 2.5;
      const sizeY = 0.8 + Math.random() * 2.5;
      const sizeZ = 0.8 + Math.random() * 2.5;
      
      // different sides / geometries
      const geomType = Math.floor(Math.random() * 3);
      let geometry;
      if (geomType === 0) geometry = new THREE.DodecahedronGeometry(1, 1);
      else if (geomType === 1) geometry = new THREE.IcosahedronGeometry(1, 1);
      else geometry = new THREE.OctahedronGeometry(1, 2);
      
      // Jitter vertices for rocky look and different sides
      const pos = geometry.attributes.position;
      const v = new THREE.Vector3();
      const rockSeed = Math.random() * 100;
      for (let j = 0; j < pos.count; j++) {
        v.fromBufferAttribute(pos, j);
        
        // Generate pseudo-random noise based on the un-displaced vertex position
        // This ensures duplicate vertices (at seams) move together, preventing gaps
        const hash = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719 + rockSeed) * 43758.5453;
        const noise = hash - Math.floor(hash);
        
        v.normalize().multiplyScalar(1 + (noise - 0.5) * 0.4);
        pos.setXYZ(j, v.x, v.y, v.z);
      }
      geometry.computeVertexNormals();
      geometry.computeBoundsTree(); // BVH for accurate point raycasting

      const material = new THREE.MeshStandardMaterial({
        map: rockTexture,
        color: new THREE.Color().setHSL(0, 0, 0.4 + Math.random() * 0.2),
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true
      });
      
      const object = new THREE.Mesh(geometry, material);
      object.scale.set(sizeX, sizeY, sizeZ);
      
      return { object };
    });
  }, [count, rockTexture]);

  const [positions, rotations] = useMemo(() => {
    const pos = [];
    const rot = [];
    for (let i = 0; i < count; i++) {
       pos.push(
        (Math.random() - 0.5) * 40,
        (Math.random() - 0.5) * 30,
        -50 - Math.random() * 150
       );
       rot.push(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    }
    return [pos, rot];
  }, [count]);

  useFrame((_, delta) => {
    if (gameOver) return;
    const ship = window.spaceshipCollider || window.spaceshipPosition;
    const shipCollisionRadius = ship.radius ?? 0.3;
    shipWorldPoint.set(ship.x, ship.y, ship.z);
    
    if (previousShipPoint.current.lengthSq() === 0) {
      previousShipPoint.current.copy(shipWorldPoint);
    }

    // Update global game time for difficulty scaling
    if (!window.gameTime) window.gameTime = 0;
    window.gameTime += delta;
    const difficultyScale = 1 + (window.gameTime / 60); // Speed doubles every 60 seconds
    
    const speed = (30 + (window.spaceshipBoost * 50)) * difficultyScale;
    
    // Direction of ship movement
    const dir = new THREE.Vector3().subVectors(shipWorldPoint, previousShipPoint.current);
    const dist = dir.length();
    const isMoving = dist > 0.00001;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3 + 2] += speed * delta;
      rotations[i3] += delta * 0.2;
      rotations[i3 + 1] += delta * 0.3;

      if (positions[i3 + 2] > 15) {
        positions[i3 + 2] = -80 - Math.random() * 80;
        positions[i3] = (Math.random() - 0.5) * 40;
        positions[i3 + 1] = (Math.random() - 0.5) * 30;
      }

      const rockObject = rocks[i].object;
      rockObject.position.set(positions[i3], positions[i3 + 1], positions[i3 + 2]);
      rockObject.rotation.set(rotations[i3], rotations[i3 + 1], rotations[i3 + 2]);
      rockObject.updateMatrixWorld(true);
      
      const distSq = previousShipPoint.current.distanceToSquared(rockObject.position);
      const maxScale = Math.max(rockObject.scale.x, rockObject.scale.y, rockObject.scale.z);
      const boundsRadius = maxScale * 1.5; // Roughly the bounds
      
      if (distSq > Math.pow(boundsRadius + 10, 2)) continue; // Optimization

      // 1. Point Raycast (Sweep test from previous to current position)
      if (isMoving) {
         raycaster.set(previousShipPoint.current, dir.clone().normalize());
         raycaster.far = dist + shipCollisionRadius; 
         const hits = raycaster.intersectObject(rockObject, false);
         if (hits.length > 0) {
            onHitRock?.();
            return;
         }
      }

      // 2. Static Point Raycast (Check distance from ship center to closest rock surface)
      const toRock = new THREE.Vector3().subVectors(rockObject.position, shipWorldPoint);
      const toRockDist = toRock.length();
      if (toRockDist <= boundsRadius + shipCollisionRadius) {
         raycaster.set(rockObject.position, toRock.clone().multiplyScalar(-1).normalize());
         raycaster.far = toRockDist;
         const hits = raycaster.intersectObject(rockObject, false);
         if (hits.length > 0) {
             const surfacePoint = hits[0].point;
             if (surfacePoint.distanceToSquared(shipWorldPoint) <= shipCollisionRadius * shipCollisionRadius) {
                 onHitRock?.();
                 return;
             }
         } else if (toRockDist < maxScale * 0.5) {
             // If raycast from rock center to ship hits nothing, but we are very close,
             // it means we are inside the geometry.
             onHitRock?.();
             return;
         }
      }
    }
    previousShipPoint.current.copy(shipWorldPoint);
  });

  return (
    <group>
      {rocks.map((rock, i) => (
        <primitive key={i} object={rock.object} />
      ))}
    </group>
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

  useFrame((_, delta) => {
    if (window.gameOver) return;
    // Handle global boost state interpolation
    if (window.spaceshipShift) {
      window.spaceshipBoost += delta / 1.0; // Takes 1s to reach full boost
      if (window.spaceshipBoost > 1) window.spaceshipBoost = 1;
    } else {
      window.spaceshipBoost -= delta / 3.0; // Takes 3s to slow down
      if (window.spaceshipBoost < 0) window.spaceshipBoost = 0;
    }

    // Normal speed is ~7, boosts up to 17
    const difficultyScale = 1 + ((window.gameTime || 0) / 60);
    // Normal speed is doubled from 7 to 14, boosts up to 20 additional
    const currentSpeed = (14 + (window.spaceshipBoost * 20)) * difficultyScale;

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
  const [gameState, setGameState] = useState('start'); // start, playing, gameover

  const startGame = (mode) => {
    window.controlMode = mode;
    window.gameOver = false;
    window.gameTime = 0;
    
    if (mode === 'mobile') {
      setGameState('mobile-permission');
    } else {
      setGameState('playing');
    }
  };

  const requestMobileAccess = async () => {
      const setupGyro = async () => {
        try {
          if (document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen();
          }
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(e => console.warn(e));
          }
        } catch (err) {
          console.warn("Fullscreen failed", err);
        }

        let isCalibrated = false;

        window.addEventListener('deviceorientation', (e) => {
           let pitch, roll;
           const angle = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
           
           if (angle === 90) {
             // Landscape primary (top to left)
             pitch = e.gamma; 
             roll = -e.beta;
           } else if (angle === -90 || angle === 270) {
             // Landscape secondary (top to right)
             pitch = -e.gamma;
             roll = e.beta;
           } else {
             // Portrait
             pitch = e.beta;
             roll = e.gamma;
           }
           
           if (!isCalibrated && pitch !== null && roll !== null) {
              window.gyroNeutralPitch = pitch;
              window.gyroNeutralRoll = roll;
              isCalibrated = true;
           }
           
           window.gyroPitch = pitch;
           window.gyroRoll = roll;
        });
        window.addEventListener('touchstart', () => { window.spaceshipShift = true; });
        window.addEventListener('touchend', () => { window.spaceshipShift = false; });
        setGameState('playing');
      };

      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(permissionState => {
          if (permissionState === 'granted') {
            setupGyro();
          } else {
            alert('Gyroscope permission denied. You can still play by touching to boost, but you cannot steer.');
            setGameState('playing'); // fallback
          }
        }).catch(err => {
          console.error(err);
          alert('Gyroscope permission error (Must be HTTPS or disable Brave Shields). Error: ' + err);
          setupGyro(); // Try anyway
        });
      } else {
        setupGyro();
      }
  };

  const handleRockCollision = () => {
    if (window.gameOver) return;
    window.gameOver = true;
    setGameState('gameover');
  };

  return (
    <div className="canvas-container">
      {gameState === 'start' && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,5,8,0.9)', zIndex: 20 }}>
          <h1 style={{ color: '#fff', marginBottom: 40, fontFamily: 'sans-serif', textAlign: 'center' }}>SPACE SURVIVAL</h1>
          <button style={{ padding: '15px 40px', fontSize: '18px', margin: '10px', cursor: 'pointer', borderRadius: '8px', border: 'none', backgroundColor: '#00aaff', color: '#fff', fontWeight: 'bold' }} onClick={() => startGame('pc')}>
            Play on PC (WASD/Arrows + Shift)
          </button>
          <button style={{ padding: '15px 40px', fontSize: '18px', margin: '10px', cursor: 'pointer', borderRadius: '8px', border: 'none', backgroundColor: '#ff5500', color: '#fff', fontWeight: 'bold' }} onClick={() => startGame('mobile')}>
            Play on Mobile (Gyroscope + Touch)
          </button>
        </div>
      )}

      {gameState === 'mobile-permission' && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,5,8,0.9)', zIndex: 20 }}>
          <h1 style={{ color: '#fff', marginBottom: 20, fontFamily: 'sans-serif', textAlign: 'center' }}>Mobile Controls</h1>
          <p style={{ color: '#ccc', marginBottom: 40, maxWidth: '80%', textAlign: 'center', fontSize: '18px', lineHeight: '1.5' }}>
            We need access to your device's orientation sensors to steer the ship. <br/><br/>
            Hold your phone comfortably like a steering wheel. That position will be your "neutral" center when you start.<br/><br/>
            <b>Brave Browser users:</b> Please turn off Shields (the lion icon) for this site, as Brave blocks sensors by default.
          </p>
          <button style={{ padding: '15px 40px', fontSize: '18px', margin: '10px', cursor: 'pointer', borderRadius: '8px', border: 'none', backgroundColor: '#00aaff', color: '#fff', fontWeight: 'bold' }} onClick={requestMobileAccess}>
            Grant Permission & Start
          </button>
        </div>
      )}

      {gameState === 'gameover' && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 0, 0, 0.2)', zIndex: 10 }}>
          <h1 style={{ color: '#ff5a5a', fontWeight: 900, fontSize: '48px', textShadow: '0 0 20px rgba(255,0,0,0.5)' }}>GAME OVER</h1>
          <button style={{ padding: '10px 20px', fontSize: '16px', marginTop: '20px', cursor: 'pointer', borderRadius: '8px', border: 'none', backgroundColor: '#fff', color: '#000' }} onClick={() => window.location.reload()}>
            Restart
          </button>
        </div>
      )}

      <Canvas camera={{ position: [0, 3, 12], fov: 45 }}>
        <color attach="background" args={['#050508']} />
        
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 10]} intensity={1.5} color="#ffffff" />
        <directionalLight position={[-10, 5, -10]} intensity={0.8} color="#e94560" />
        
        <Suspense fallback={null}>
          {gameState === 'playing' && (
            <>
              <Center>
                <Webspaceship scale={0.5} gameOver={gameState === 'gameover'} />
              </Center>
              <ContactShadows position={[0, -2.5, 0]} opacity={0.7} scale={20} blur={2.5} far={4} />
              <MovingStars />
              <RockObstacles gameOver={gameState === 'gameover'} onHitRock={handleRockCollision} />
            </>
          )}
          <Environment preset="night" />
        </Suspense>

        {/* Full Controls for the 3D scene (Rotate, Pan, Zoom) */}
        {gameState === 'start' && <OrbitControls ref={orbitRef} enableZoom={false} enablePan={false} autoRotate={true} autoRotateSpeed={0.5} />}
      </Canvas>
    </div>
  );
}

export default App;
