
import * as THREE from 'three';
import React, { useEffect, useRef } from 'react';
import classnames from 'classnames';

import metaversefile from 'metaversefile';

import styles from './character-overview.module.css';

//

let renderer;
let camera;
let scene;
let characterWrapper;
let oldParent = null;

//

export const CharacterOverview = ({ opened, setOpened }) => {

    const canvas = useRef( null );
    const localPlayer = metaversefile.useLocalPlayer();

    //

    const handleCloseBtnClick = ( event ) => {

        setOpened( false );

    };

    const resetAvatarMesh = ( mesh, mode ) => {

        mesh.traverse( ( item ) => {

            if ( item instanceof THREE.Mesh ) {

                if ( item.material instanceof Array ) {

                    const materials = [];

                    item.material.forEach( ( oldMaterial ) => {

                        let newMaterial;

                        // tmp this should be changed later to proper clone method

                        newMaterial = new THREE.MeshLambertMaterial({ map: oldMaterial.map, color: 0x111111 });
                        materials.push( newMaterial );

                    });

                    if ( mode === 'inventory' ) {

                        item.userData.sceneOrigMaterial = item.userData.sceneOrigMaterial ?? item.material;
                        item.material = materials;

                    } else {

                        item.material = item.userData.sceneOrigMaterial;

                    }

                    item.material.forEach( ( oldMaterial ) => { oldMaterial.needsUpdate = true; });

                } else {

                    if ( mode === 'inventory' ) {

                        item.userData.sceneOrigMaterial = item.material;
                        item.material = item.material.clone();

                    } else {

                        item.material = item.userData.sceneOrigMaterial;

                    }

                }

            }

        });

    };

    const refresh = ( enabled ) => {

        if ( ! renderer && canvas ) {

            characterWrapper = new THREE.Object3D();
            renderer = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true, alpha: true });
            const canvasSize = canvas.current.parentNode.getBoundingClientRect();
            renderer.setSize( canvasSize.width, canvasSize.height );
            camera = new THREE.PerspectiveCamera( 50, 1, 1, 2000 );
            camera.position.set( 0, 1.5, - 2 );
            camera.aspect = canvasSize.width / canvasSize.height;
            camera.updateProjectionMatrix();
            camera.lookAt( 0, 0.8, 0 );
            scene = new THREE.Scene();
            scene.background = null;

            scene.add( characterWrapper );
            scene.add( new THREE.AmbientLight( 0xffffff, 10 ) );

        } else {

            const avatarModel = localPlayer.avatar.model;

            if ( enabled ) {

                oldParent = avatarModel.parent;
                console.log( avatarModel );
                avatarModel.parent.remove( avatarModel );
                resetAvatarMesh( avatarModel, 'inventory' );

                const characterPos = localPlayer.getPosition();
                const characterRot = localPlayer.getQuaternion();
                const quaternion = new THREE.Quaternion().set( characterRot[0], characterRot[1], characterRot[2], characterRot[3] );
                const rot = new THREE.Euler().setFromQuaternion( quaternion, 'XYZ' );
                avatarModel.position.set( - characterPos[0], - characterPos[1] + 1.25, - characterPos[2] );
                characterWrapper.rotation.set( - rot.x, - rot.y, - rot.z );
                characterWrapper.add( avatarModel );
                characterWrapper.updateMatrixWorld( true, true );

            } else if ( ! enabled && oldParent ) {

                avatarModel.parent.remove( avatarModel );
                resetAvatarMesh( avatarModel, 'mainscene' );
                oldParent.add( avatarModel );
                avatarModel.position.set( 0, 0, 0 );
                avatarModel.updateMatrixWorld( true, true );
                oldParent = null;

            }

        }

    };

    const render = () => {

        renderer.render( scene, camera );

    };

    useEffect( () => {

        let renderLoop = () => {

            render();
            if ( ! renderLoop || ! opened ) return;
            requestAnimationFrame( renderLoop );

        };

        const handleKeyPress = ( event ) => {

            if ( opened && event.key === 'Escape' ) {

                setOpened( false );

            }

            if ( opened === false && event.which === 73 ) {

                setOpened( true );

            }

        };

        window.addEventListener( 'keydown', handleKeyPress );

        refresh( opened );
        renderLoop();

        //

        return () => {

            window.removeEventListener( 'keydown', handleKeyPress );
            renderLoop = null;

        };

    }, [ opened ] );

    //

    return (
        <div className={ classnames( styles.characterOverview, opened ? styles.open : null ) }>
            <div className={ styles.characterItems }>
                <div className={ styles.header }>
                    ITEMS
                </div>
                <div className={ styles.contentWrapper }>
                    <div className={ styles.content }>
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                        <div className={ styles.slot } />
                    </div>
                </div>
            </div>
            <div className={ styles.characterBlock }>
                <canvas className={ styles.characterBlockCanvas } ref={ canvas } />
            </div>
            <div className={ styles.backBtn } onClick={ handleCloseBtnClick }>
                <div className={ styles.icon } />
                <div className={ styles.label }>BACK</div>
            </div>
        </div>
    );

};
