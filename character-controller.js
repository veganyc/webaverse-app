/*
this file is responisible for maintaining player state that is network-replicated.
*/
import {WsAudioDecoder} from 'wsrtc/ws-codec.js';
import {ensureAudioContext, getAudioContext} from'wsrtc/ws-audio-context.js';
import {getAudioDataBuffer} from 'wsrtc/ws-util.js';

import {murmurhash3} from './procgen/murmurhash3.js';
import * as THREE from "three";
import * as Z from "zjs";
import { getRenderer, scene, camera, dolly } from "./renderer.js";
import physicsManager from "./physics-manager.js";
import { world } from "./world.js";
import cameraManager from "./camera-manager.js";
import physx from "./physx.js";
import Avatar from "./avatars/avatars.js";
import metaversefile from "metaversefile";
import {
  actionsMapName,
  avatarMapName,
  appsMapName,
  playersMapName,
  crouchMaxTime,
  activateMaxTime,
  // useMaxTime,
  aimTransitionMaxTime,
  avatarInterpolationFrameRate,
  avatarInterpolationTimeDelay,
  avatarInterpolationNumFrames,
  // groundFriction,
  voiceEndpoint,
  numLoadoutSlots,
} from "./constants.js";
import { AppManager } from "./app-manager.js";
import { CharacterPhysics } from "./character-physics.js";
import { CharacterHups } from "./character-hups.js";
import { CharacterSfx } from "./character-sfx.js";
import { CharacterBehavior } from "./character-behavior.js";
import { CharacterFx } from "./character-fx.js";
import {
  VoicePack,
  VoicePackVoicer,
} from "./voice-output/voice-pack-voicer.js";
import {
  VoiceEndpoint,
  VoiceEndpointVoicer,
} from "./voice-output/voice-endpoint-voicer.js";
import {
  BinaryInterpolant,
  BiActionInterpolant,
  UniActionInterpolant,
  InfiniteActionInterpolant,
  PositionInterpolant,
  QuaternionInterpolant,
} from "./interpolants.js";
import { applyPlayerToAvatar, switchAvatar } from "./player-avatar-binding.js";
import { defaultPlayerName, defaultPlayerBio } from "./ai/lore/lore-model.js";
import { makeId, clone, unFrustumCull, enableShadows } from "./util.js";

import * as sounds from "./sounds.js";

const localVector = new THREE.Vector3();
// const localVector2 = new THREE.Vector3();
// const localQuaternion = new THREE.Quaternion();
// const localQuaternion2 = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();
const localArray3 = [0, 0, 0];
const localArray4 = [0, 0, 0, 0];

function makeCancelFn() {
  let live = true;
  return {
    isLive() {
      return live;
    },
    cancel() {
      live = false;
    },
  };
}
const heightFactor = 1.6;
const baseRadius = 0.3;
function loadPhysxCharacterController() {
  const avatarHeight = this.avatar?.height || 1;
  const radius = (baseRadius / heightFactor) * avatarHeight;
  const height = avatarHeight - radius * 2;

  const contactOffset = (0.1 / heightFactor) * avatarHeight;
  const stepOffset = (0.5 / heightFactor) * avatarHeight;

  const position = this.position
    .clone()
    .add(new THREE.Vector3(0, -avatarHeight / 2, 0));

  if (this.characterController) {
    physicsManager.destroyCharacterController(this.characterController);
    this.characterController = null;
    // this.characterControllerObject = null;
  }
  this.characterController = physicsManager.createCharacterController(
    radius - contactOffset,
    height,
    contactOffset,
    stepOffset,
    position
  );
  // this.characterControllerObject = new THREE.Object3D();
}
/* function loadPhysxAuxCharacterCapsule() {
  const avatarHeight = this.avatar.height;
  const radius = baseRadius/heightFactor * avatarHeight;
  const height = avatarHeight - radius*2;
  const halfHeight = height/2;

  const position = this.position.clone()
    .add(new THREE.Vector3(0, -avatarHeight/2, 0));
  const physicsMaterial = new THREE.Vector3(0, 0, 0);

  const physicsObject = physicsManager.addCapsuleGeometry(
    position,
    localQuaternion.copy(this.quaternion)
      .premultiply(
        localQuaternion2.setFromAxisAngle(
          localVector.set(0, 0, 1),
          Math.PI/2
        )
      ),
    radius,
    halfHeight,
    physicsMaterial,
    true
  );
  physicsObject.name = 'characterCapsuleAux';
  physicsManager.setGravityEnabled(physicsObject, false);
  physicsManager.setLinearLockFlags(physicsObject.physicsId, false, false, false);
  physicsManager.setAngularLockFlags(physicsObject.physicsId, false, false, false);
  this.physicsObject = physicsObject;
} */

class PlayerHand extends THREE.Object3D {
  constructor() {
    super();

    this.pointer = 0;
    this.grab = 0;
    this.enabled = false;
  }
}
class PlayerBase extends THREE.Object3D {
  constructor() {
    super();

    this.leftHand = new PlayerHand();
    this.rightHand = new PlayerHand();
    this.hands = [this.leftHand, this.rightHand];
    this.wornApps = []
    this.avatar = null;

    this.appManager = new AppManager();

    this.appManager.addEventListener("appadd", (e) => {
      // console.log("e", e)
      const app = e.data;
      scene.add(app);
      // console.log("appadd called")
    });
    this.appManager.addEventListener("appremove", (e) => {
      const app = e.data;
      app.parent && app.parent.remove(app);
    });

    this.eyeballTarget = new THREE.Vector3();
    this.eyeballTargetEnabled = false;
    this.voicePack = null;
    this.voiceEndpoint = null;
  }
  findAction(fn) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (fn(action)) {
        return action;
      }
    }
    return null;
  }
  findActionIndex(fn) {
    const actions = this.getActionsState();
    let i = 0;
    for (const action of actions) {
      if (fn(action)) {
        return i;
      }
      i++;
    }
    return -1;
  }
  getAction(type) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (action.type === type) {
        return action;
      }
    }
    return null;
  }
  getActionByActionId(actionId) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (action.actionId === actionId) {
        return action;
      }
    }
    return null;
  }
  getActionIndex(type) {
    const actions = this.getActionsState();
    let i = 0;
    for (const action of actions) {
      if (action.type === type) {
        return i;
      }
      i++;
    }
    return -1;
  }
  indexOfAction(action) {
    const actions = this.getActionsState();
    let i = 0;
    for (const a of actions) {
      if (a === action) {
        return i;
      }
      i++;
    }
    return -1;
  }
  hasAction(type) {
    const actions = this.getActionsState();
    for (const action of actions) {
      if (action.type === type) {
        return true;
      }
    }
    return false;
  }
  async loadVoicePack({ audioUrl, indexUrl }) {
    this.voicePack = await VoicePack.load({
      audioUrl,
      indexUrl,
    });
    this.updateVoicer();
  }
  setVoiceEndpoint(voiceId) {
    if (voiceId) {
      const url = `${voiceEndpoint}?voice=${encodeURIComponent(voiceId)}`;
      this.voiceEndpoint = new VoiceEndpoint(url);
    } else {
      this.voiceEndpoint = null;
    }
    this.updateVoicer();
  }
  getVoice() {
    return this.voiceEndpoint || this.voicePack || null;
  }
  updateVoicer() {
    const voice = this.getVoice();
    if (voice instanceof VoicePack) {
      const { syllableFiles, audioBuffer } = voice;
      this.voicer = new VoicePackVoicer(syllableFiles, audioBuffer, this);
    } else if (voice instanceof VoiceEndpoint) {
      this.voicer = new VoiceEndpointVoicer(voice, this);
    } else if (voice === null) {
      this.voicer = null;
    } else {
      throw new Error("invalid voice");
    }
  }
  getCrouchFactor() {
    return 1 - 0.4 * this.actionInterpolants.crouch.getNormalized();
    /* let factor = 1;
    factor *= 1 - 0.4 * this.actionInterpolants.crouch.getNormalized();
    return factor; */
  }
  wear(app, { loadoutIndex = -1 } = {}) {
    console.log("Wearx called in PlayerBase of Character Controller", app, loadoutIndex);
    const _getNextLoadoutIndex = () => {
      let loadoutIndex = -1;
      const usedIndexes = Array(8).fill(false);
      for (const action of this.getActionsState()) {
        if (action.type === "wear") {
          usedIndexes[action.loadoutIndex] = true;
        }
      }
      for (let i = 0; i < usedIndexes.length; i++) {
        if (!usedIndexes[i]) {
          loadoutIndex = i;
          break;
        }
      }
      return loadoutIndex;
    };
    if (loadoutIndex === -1) {
      loadoutIndex = _getNextLoadoutIndex();
    }
    this.wornApps.push(app);

    if (loadoutIndex >= 0 && loadoutIndex < numLoadoutSlots) {
      const _removeOldApp = () => {
        const actions = this.getActionsState();
        let oldLoadoutAction = null;
        for (let i = 0; i < actions.length; i++) {
          const action = actions.get(i);
          if (action.type === "wear" && action.loadoutIndex === loadoutIndex) {
            oldLoadoutAction = action;
            break;
          }
        }
        if (oldLoadoutAction) {
          const app = this.appManager.getAppByInstanceId(
            oldLoadoutAction.instanceId
          );
          this.unwear(app, {
            destroy: true,
          });
        }
      };
      _removeOldApp();

      const _transplantNewApp = () => {
        if (world.appManager.hasTrackedApp(app.instanceId)) {
          world.appManager.transplantApp(app, this.appManager);
        } else {
          console.warn(
            "need to transplant unowned app",
            app,
            world.appManager,
            this.appManager
          );
        }
      };
      _transplantNewApp();

      const _initPhysics = () => {
        const physicsObjects = app.getPhysicsObjects();
        for (const physicsObject of physicsObjects) {
          physx.physxWorker.disableGeometryQueriesPhysics(
            physx.physics,
            physicsObject.physicsId
          );
          physx.physxWorker.disableGeometryPhysics(
            physx.physics,
            physicsObject.physicsId
          );
        }
      };
      _initPhysics();

      this.addAction({
        type: "wear",
        instanceId: app.instanceId,
        loadoutIndex,
      });

      this.dispatchEvent({
        type: 'wearupdate',
        player: this,
        app,
        wear: true,
        loadoutIndex,
      });
    } else {
      this.dispatchEvent({
        type: 'wearupdate',
        player: this,
        app,
        wear: true
      });
      }
  }
  unwear(app, { destroy = false } = {}) {
    console.log("Unwear called in PlayerBase of Character Controller", app, destroy);
    const wearActionIndex = this.findActionIndex(({ type, instanceId }) => {
      return type === "wear" && instanceId === app.instanceId;
    });

    const _setAppTransform = () => {
        const avatarHeight = this.avatar ? this.avatar.height : 0;
        app.position
          .copy(this.position)
          .add(
            localVector
              .set(0, -avatarHeight + 0.5, -0.5)
              .applyQuaternion(this.quaternion)
          );
        app.quaternion.identity();
        app.scale.set(1, 1, 1);
        app.updateMatrixWorld();
    };
    _setAppTransform();

    const _deinitPhysics = () => {
      const physicsObjects = app.getPhysicsObjects();
      for (const physicsObject of physicsObjects) {
        physx.physxWorker.enableGeometryQueriesPhysics(
          physx.physics,
          physicsObject.physicsId
        );
        physx.physxWorker.enableGeometryPhysics(
          physx.physics,
          physicsObject.physicsId
        );
      }
    };
    _deinitPhysics();

    if (wearActionIndex !== -1) {
      const wearAction = this.getActionsState().get(wearActionIndex);
      const loadoutIndex = wearAction.loadoutIndex;

      const _removeApp = () => {
        this.removeActionIndex(wearActionIndex);

        if (this.appManager.hasTrackedApp(app.instanceId)) {
          if (destroy) {
            this.appManager.removeApp(app);
            app.destroy();
          } else {
            this.appManager.transplantApp(app, world.appManager);
          }
        } else {
          console.warn('need to transplant unowned app', app, this.appManager, world.appManager);
          // debugger;
        }
      };
      _removeApp();
      const _emitEvents = () => {
        this.dispatchEvent({
          type: 'wearupdate',
          player: this,
          wear: false,
          loadoutIndex
        });
        app.dispatchEvent({
          type: 'wearupdate',
          player: this,
          wear: false,
          loadoutIndex
        });
      };
      _emitEvents();
      
    }
    
    const _emitEvents = () => {
      this.dispatchEvent({
        type: 'wearupdate',
        player: this,
        wear: false
      });
      app.dispatchEvent({
        type: 'wearupdate',
        player: this,
        wear: false
      });
    };
    _emitEvents();
    this.wornApps.splice(this.wornApps.indexOf(app));
  }

}

const controlActionTypes = ["jump", "crouch", "fly", "sit"];
class StatePlayer extends PlayerBase {
  constructor({
    playerId = makeId(5),
    playersArray = new Z.Doc().getArray(playersMapName),
  } = {}) {
    super();

    this.playerId = playerId;
    this.playerIdInt = murmurhash3(playerId);

    this.playersArray = null;
    this.playerMap = null;
    this.microphoneMediaStream = null;

    this.avatarEpoch = 0;
    this.syncAvatarCancelFn = null;
    this.unbindFns = [];

    this.bindState(playersArray);
  }
  setAudioDecoder() {
    this.audioDecoder = new WsAudioDecoder({ output: this.avatar.getAudioInput()});
  }
  isBound() {
    return !!this.playersArray;
  }
  unbindState() {
    // console.log('character controller unbind state');

    if (this.isBound()) {
      this.playersArray = null;
      this.playerMap = null;

      for (const unbindFn of this.unbindFns) {
        unbindFn();
      }
      this.unbindFns.length = 0;
    } else {
      console.warn("Warning, calling unbindState on an unbound player")
    }
  }
  detachState() {
    throw new Error("called abstract method");
  }
  attachState(oldState) {
    throw new Error("called abstract method");
  }
  bindCommonObservers() {
    const actions = this.getActionsState();
    let lastActions = actions.toJSON();
    const observeActionsFn = () => {
      const nextActions = Array.from(this.getActionsState());
      for (const nextAction of nextActions) {
        if (
          !lastActions.some(
            (lastAction) => lastAction.actionId === nextAction.actionId
          )
        ) {
          this.dispatchEvent({
            type: "actionadd",
            action: nextAction,
          });
          // console.log('add action', nextAction);
        }
      }
      for (const lastAction of lastActions) {
        if (
          !nextActions.some(
            (nextAction) => nextAction.actionId === lastAction.actionId
          )
        ) {
          this.dispatchEvent({
            type: "actionremove",
            action: lastAction,
          });
          // console.log('remove action', lastAction);
        }
      }
      // console.log('actions changed');
      lastActions = nextActions;
    };
    actions.observe(observeActionsFn);
    this.unbindFns.push(actions.unobserve.bind(actions, observeActionsFn));

    const avatar = this.getAvatarState();
    let lastAvatarInstanceId = "";
    const observeAvatarFn = async () => {
      // we are in an observer and we want to perform a state transaction as a result
      // therefore we need to yeild out of the observer first or else the other transaction handlers will get confused about timing
      await Promise.resolve();

      const instanceId = this.getAvatarInstanceId();
      if (lastAvatarInstanceId !== instanceId) {
        lastAvatarInstanceId = instanceId;

        this.syncAvatar();
      }
    };
    avatar.observe(observeAvatarFn);
    this.unbindFns.push(avatar.unobserve.bind(avatar, observeAvatarFn));

    const _cancelSyncAvatar = () => {
      if (this.syncAvatarCancelFn) {
        this.syncAvatarCancelFn();
        this.syncAvatarCancelFn = null;
      }
    };
    this.unbindFns.push(_cancelSyncAvatar);
  }
  bindState(nextPlayersArray) {    
    // latch old state
    const oldState = this.detachState();

    // unbind
    this.unbindState();
    if (this.isLocalPlayer) {
      this.appManager.unbindStateLocal();
    } else {
      this.appManager.unbindStateRemote();
    }

    // note: leave the old state as is. it is the host's responsibility to garbage collect us when we disconnect.

    // blindly add to new state
    this.playersArray = nextPlayersArray;
    window.playersArray = this.playersArray;
    if (this.playersArray) {
      this.attachState(oldState);
      this.bindCommonObservers();
    }
  }
  getAvatarInstanceId() {
    return this.getAvatarState().get("instanceId") ?? "";
  }
  localVector = [0, 0, 0];
  localQuaternion = [0, 0, 0, 1];
  // serializers
  getPosition() {
    return this.position.toArray(this.localVector);
  }
  getQuaternion() {
    return this.quaternion.toArray(this.localQuaternion);
  }
  async syncAvatar() {
    if (this.syncAvatarCancelFn) {
      this.syncAvatarCancelFn.cancel();
      this.syncAvatarCancelFn = null;
    }
    const cancelFn = makeCancelFn();
    this.syncAvatarCancelFn = cancelFn;

    const instanceId = this.getAvatarInstanceId();

    // remove last app
    if (this.avatar) {
      const oldPeerOwnerAppManager = this.appManager.getPeerOwnerAppManager(
        this.avatar.app.instanceId
      );
      if (oldPeerOwnerAppManager) {
        // console.log('transplant last app');
        this.appManager.transplantApp(this.avatar.app, oldPeerOwnerAppManager);
      } else {
        // console.log('remove last app', this.avatar.app);
        // this.appManager.removeTrackedApp(this.avatar.app.instanceId);
      }
    }

    const _setNextAvatarApp = (app) => {
      (() => {
        const avatar = switchAvatar(this.avatar, app);
        if (!cancelFn.isLive()) return console.log("canceling the function");
        this.avatar = avatar;

        this.dispatchEvent({
          type: "avatarchange",
          app,
          avatar,
        });

        loadPhysxCharacterController.call(this);
        // console.log('disable actor', this.characterController);
        physicsManager.disableGeometryQueries(this.characterController);
      })();

      this.dispatchEvent({
        type: "avatarupdate",
        app,
      });
    };

    if (instanceId) {
      // add next app from player app manager
      const nextAvatarApp = this.appManager.getAppByInstanceId(instanceId);
      // console.log('add next avatar local', nextAvatarApp);
      if (nextAvatarApp) {
        _setNextAvatarApp(nextAvatarApp);
      } else {
        // add next app from world app manager
        const nextAvatarApp = world.appManager.getAppByInstanceId(instanceId);
        // console.log('add next avatar world', nextAvatarApp);
        if (nextAvatarApp) {
          world.appManager.transplantApp(nextAvatarApp, this.appManager);
          _setNextAvatarApp(nextAvatarApp);
        } else {
          // add next app from currently loading apps
          const addPromise = this.appManager.pendingAddPromises.get(instanceId);
          if (addPromise) {
            const nextAvatarApp = await addPromise;
            if (!cancelFn.isLive()) return;
            _setNextAvatarApp(nextAvatarApp);
          } else {
            console.warn(
              "switching avatar to instanceId that does not exist in any app manager",
              instanceId
            );
          }
        }
      }
    } else {
      _setNextAvatarApp(null);
    }

    this.syncAvatarCancelFn = null;
  }
  setSpawnPoint(position, quaternion) {
    const localPlayer = metaversefile.useLocalPlayer();
    localPlayer.position.copy(position);
    localPlayer.quaternion.copy(quaternion);

    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    camera.updateMatrixWorld();

    if (this.characterPhysics) {
      this.characterPhysics.setPosition(position);
    }
  }
  getActions() {
    return this.getActionsState();
  }
  getActionsState() {
    let actionsArray = this.playerMap.has(avatarMapName)
      ? this.playerMap.get(actionsMapName, Z.Array)
      : null;
    if (!actionsArray) {
      actionsArray = new Z.Array();
      this.playerMap.set(actionsMapName, actionsArray);
    }
    return actionsArray;
  }
  getActionsArray() {
    return this.isBound() ? Array.from(this.getActionsState()) : [];
  }
  getAvatarState() {
    let avatarMap = this.playerMap.has(avatarMapName)
      ? this.playerMap.get(avatarMapName, Z.Map)
      : null;
    if (!avatarMap) {
      avatarMap = new Z.Map();
      this.playerMap.set(avatarMapName, avatarMap);
    }
    return avatarMap;
  }
  getAppsState() {
    let appsArray = this.playerMap.has(appsMapName)
      ? this.playerMap.get(appsMapName, Z.Array)
      : null;
    if (!appsArray) {
      appsArray = new Z.Array();
      this.playerMap.set(appsMapName, appsArray);
    }
    return appsArray;
  }
  getAppsArray() {
    return this.isBound() ? Array.from(this.getAppsState()) : [];
  }
  addAction(action) {
    action = clone(action);
    action.actionId = makeId(5);
    this.getActionsState().push([action]);
    return action;
  }
  removeAction(type) {
    const actions = this.getActionsState();
    let i = 0;
    for (const action of actions) {
      if (action.type === type) {
        actions.delete(i);
        break;
      }
      i++;
    }
  }
  removeActionIndex(index) {
    this.getActionsState().delete(index);
  }
  clearActions() {
    const actionsState = this.getActionsState();
    const numActions = actionsState.length;
    for (let i = numActions - 1; i >= 0; i--) {
      this.removeActionIndex(i);
    }
  }
  setControlAction(action) {
    const actions = this.getActionsState();
    for (let i = 0; i < actions.length; i++) {
      const action = actions.get(i);
      const isControlAction = controlActionTypes.includes(action.type);
      if (isControlAction) {
        actions.delete(i);
        i--;
      }
    }
    action.controllingBone =
      action.type === "sit" ? null : action.controllingBone;
    actions.push([action]);
  }
  setMicMediaStream(mediaStream) {
    if(!this.avatar)
      return console.log("Can't set mic media stream, no avatar");
    if (this.microphoneMediaStream) {
      this.microphoneMediaStream.disconnect();
      this.microphoneMediaStream = null;
    }
    if (mediaStream) {
      this.avatar.setAudioEnabled(true, this);
      const audioContext = Avatar.getAudioContext();
      const mediaStreamSource =
        audioContext.createMediaStreamSource(mediaStream);
      if(!this.isLocalPlayer)
        mediaStreamSource.connect(this.avatar.getAudioInput());
      this.microphoneMediaStream = mediaStreamSource;
    }
  }
  new() {
    const self = this;
    this.playersArray.doc.transact(function tx() {
      const actions = self.getActionsState();
      while (actions.length > 0) {
        actions.delete(actions.length - 1);
      }

      const avatar = self.getAvatarState();
      avatar.delete("instanceId");

      const apps = self.getAppsState();
      while (apps.length > 0) {
        apps.delete(apps.length - 1);
      }
    });
  }
  save() {
    const actions = this.getActionsState();
    const avatar = this.getAvatarState();
    const apps = this.getAppsState();
    return JSON.stringify({
      // actions: actions.toJSON(),
      avatar: avatar.toJSON(),
      apps: apps.toJSON(),
    });
  }
  load(s) {
    const j = JSON.parse(s);
    console.log('load', j);
    const self = this;
    this.playersArray.doc.transact(function tx() {
      const actions = self.getActionsState();
      while (actions.length > 0) {
        actions.delete(actions.length - 1);
      }

      const avatar = self.getAvatarState();
      if (j?.avatar?.instanceId) {
        avatar.set("instanceId", j.avatar.instanceId);
      }

      const apps = self.getAppsState();
      if (Array.isArray(j?.apps)) {
        for (const app of j.apps) {
          apps.push([app]);
        }
      }
    });
  }
  destroy() {
    if (this.isLocalPlayer) {
      const wearActions = Array.from(this.getActionsState()).filter(
        (action) => action.type === "wear"
      );
      for (const wearAction of wearActions) {
        const instanceId = wearAction.instanceId;
        const app = metaversefileApi.getAppByInstanceId(instanceId);
        if (
          app.getComponent("wear") ||
          app.getComponent("sit") ||
          app.getComponent("pet")
        ) {
          app.unwear();
        }
      }
    }

    this.unbindState();
    if (this.isLocalPlayer) {
      this.appManager.unbindStateLocal();
    } else {
      this.appManager.unbindStateRemote();
    }

    this.appManager.destroy();
  }
}
class InterpolatedPlayer extends StatePlayer {
  constructor(opts) {
    super(opts);

    this.positionInterpolant = new PositionInterpolant(
      () => this.getPosition(),
      avatarInterpolationTimeDelay,
      avatarInterpolationNumFrames
    );
    this.quaternionInterpolant = new QuaternionInterpolant(
      () => this.getQuaternion(),
      avatarInterpolationTimeDelay,
      avatarInterpolationNumFrames
    );

    this.actionBinaryInterpolants = {
      crouch: new BinaryInterpolant(
        () => this.hasAction("crouch"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      activate: new BinaryInterpolant(
        () => this.hasAction("activate"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      use: new BinaryInterpolant(
        () => this.hasAction("use"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      aim: new BinaryInterpolant(
        () => this.hasAction("aim"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      narutoRun: new BinaryInterpolant(
        () => this.hasAction("narutoRun"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      fly: new BinaryInterpolant(
        () => this.hasAction("fly"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      jump: new BinaryInterpolant(
        () => this.hasAction("jump"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      dance: new BinaryInterpolant(
        () => this.hasAction("dance"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      emote: new BinaryInterpolant(
        () => this.hasAction("emote"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
      // throw: new BinaryInterpolant(() => this.hasAction('throw'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // chargeJump: new BinaryInterpolant(() => this.hasAction('chargeJump'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // standCharge: new BinaryInterpolant(() => this.hasAction('standCharge'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // fallLoop: new BinaryInterpolant(() => this.hasAction('fallLoop'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // swordSideSlash: new BinaryInterpolant(() => this.hasAction('swordSideSlash'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      // swordTopDownSlash: new BinaryInterpolant(() => this.hasAction('swordTopDownSlash'), avatarInterpolationTimeDelay, avatarInterpolationNumFrames),
      hurt: new BinaryInterpolant(
        () => this.hasAction("hurt"),
        avatarInterpolationTimeDelay,
        avatarInterpolationNumFrames
      ),
    };
    this.actionBinaryInterpolantsArray = Object.keys(
      this.actionBinaryInterpolants
    ).map((k) => this.actionBinaryInterpolants[k]);
    this.actionInterpolants = {
      crouch: new BiActionInterpolant(() => this.actionBinaryInterpolants.crouch.get(),0,
        crouchMaxTime
      ),
      activate: new UniActionInterpolant(
        () => this.actionBinaryInterpolants.activate.get(),
        0,
        activateMaxTime
      ),
      use: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.use.get(),
        0
      ),
      unuse: new InfiniteActionInterpolant(
        () => !this.actionBinaryInterpolants.use.get(),
        0
      ),
      aim: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.aim.get(),
        0
      ),
      aimRightTransition: new BiActionInterpolant(() => this.hasAction('aim') && this.hands[0].enabled, 0, aimTransitionMaxTime),
      aimLeftTransition: new BiActionInterpolant(() => this.hasAction('aim') && this.hands[1].enabled, 0, aimTransitionMaxTime),
      narutoRun: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.narutoRun.get(),
        0
      ),
      fly: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.fly.get(),
        0
      ),
      jump: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.jump.get(),
        0
      ),
      dance: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.dance.get(),
        0
      ),
      emote: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.emote.get(),
        0
      ),
      // throw: new UniActionInterpolant(() => this.actionBinaryInterpolants.throw.get(), 0, throwMaxTime),
      // chargeJump: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.chargeJump.get(), 0),
      // standCharge: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.standCharge.get(), 0),
      // fallLoop: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.fallLoop.get(), 0),
      // swordSideSlash: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.swordSideSlash.get(), 0),
      // swordTopDownSlash: new InfiniteActionInterpolant(() => this.actionBinaryInterpolants.swordTopDownSlash.get(), 0),
      hurt: new InfiniteActionInterpolant(
        () => this.actionBinaryInterpolants.hurt.get(),
        0
      ),
    };
    this.actionInterpolantsArray = Object.keys(this.actionInterpolants).map(
      (k) => this.actionInterpolants[k]
    );

    this.avatarBinding = {
      position: this.positionInterpolant.get(),
      quaternion: this.quaternionInterpolant.get(),
    };
  }
  updateInterpolation(timeDiff) {
    this.positionInterpolant.update(timeDiff);
    this.quaternionInterpolant.update(timeDiff);

    for (const actionBinaryInterpolant of this.actionBinaryInterpolantsArray) {
      actionBinaryInterpolant.update(timeDiff);
    }
    for (const actionInterpolant of this.actionInterpolantsArray) {
      actionInterpolant.update(timeDiff);
    }
  }
}
class UninterpolatedPlayer extends StatePlayer {
  constructor(opts) {
    super(opts);

    UninterpolatedPlayer.init.apply(this, arguments);
  }
  static init() {
    this.actionInterpolants = {
      crouch: new BiActionInterpolant(() => this.hasAction('crouch'), 0, crouchMaxTime),
      activate: new UniActionInterpolant(() => this.hasAction('activate'), 0, activateMaxTime),
      use: new InfiniteActionInterpolant(() => this.hasAction('use'), 0),
      unuse: new InfiniteActionInterpolant(() => !this.hasAction('use'), 0),
      aim: new InfiniteActionInterpolant(() => this.hasAction('aim'), 0),
      aimRightTransition: new BiActionInterpolant(() => this.hasAction('aim') && this.hands[0].enabled, 0, aimTransitionMaxTime),
      aimLeftTransition: new BiActionInterpolant(() => this.hasAction('aim') && this.hands[1].enabled, 0, aimTransitionMaxTime),
      narutoRun: new InfiniteActionInterpolant(() => this.hasAction('narutoRun'), 0),
      fly: new InfiniteActionInterpolant(() => this.hasAction('fly'), 0),
      jump: new InfiniteActionInterpolant(() => this.hasAction('jump'), 0),
      dance: new BiActionInterpolant(() => this.hasAction('dance'), 0, crouchMaxTime),
      emote: new BiActionInterpolant(() => this.hasAction('emote'), 0, crouchMaxTime),
      // throw: new UniActionInterpolant(() => this.hasAction('throw'), 0, throwMaxTime),
      // chargeJump: new InfiniteActionInterpolant(() => this.hasAction('chargeJump'), 0),
      // standCharge: new InfiniteActionInterpolant(() => this.hasAction('standCharge'), 0),
      // fallLoop: new InfiniteActionInterpolant(() => this.hasAction('fallLoop'), 0),
      // swordSideSlash: new InfiniteActionInterpolant(() => this.hasAction('swordSideSlash'), 0),
      // swordTopDownSlash: new InfiniteActionInterpolant(() => this.hasAction('swordTopDownSlash'), 0),
      hurt: new InfiniteActionInterpolant(() => this.hasAction("hurt"), 0),
    };
    this.actionInterpolantsArray = Object.keys(this.actionInterpolants).map(
      (k) => this.actionInterpolants[k]
    );

    this.avatarBinding = {
      position: this.position,
      quaternion: this.quaternion,
    };
  }
  updateInterpolation(timestamp, timeDiff) {
    for (const actionInterpolant of this.actionInterpolantsArray) {
      actionInterpolant.update(timestamp, timeDiff);
    }
  }
}
class LocalPlayer extends UninterpolatedPlayer {
  constructor(opts) {
    super(opts);

    this.isLocalPlayer = true;

    this.name = defaultPlayerName;
    this.bio = defaultPlayerBio;
    // If these weren't set on constructor (which they aren't on remote player) then set them now
    this.characterPhysics = this.characterPhysics ?? new CharacterPhysics(this);
    this.characterHups = this.characterHups ?? new CharacterHups(this);
    this.characterSfx = this.characterSfx ?? new CharacterSfx(this);
    this.characterFx = this.characterFx ?? new CharacterFx(this);
    this.characterBehavior =
      this.characterBehavior ?? new CharacterBehavior(this);
  }
  async setAvatarUrl(u) {
    const localAvatarEpoch = ++this.avatarEpoch;
    const avatarApp = await this.appManager.addTrackedApp(u);
    if (this.avatarEpoch !== localAvatarEpoch) {
      this.appManager.removeTrackedApp(avatarApp.instanceId);
      return;
    }

    this.setAvatarApp(avatarApp);
  }
  getAvatarApp() {
    const avatar = this.getAvatarState();
    const instanceId = avatar.get("instanceId");
    return this.appManager.getAppByInstanceId(instanceId);
  }
  setAvatarApp(app) {
    const self = this;
    this.playersArray.doc.transact(function tx() {
      console.log("setAvatarApp")
      const avatar = self.getAvatarState();
      const oldInstanceId = avatar.get("instanceId");

      avatar.set("instanceId", app.instanceId);

      if (oldInstanceId) {
        self.appManager.removeTrackedAppInternal(oldInstanceId);
      }
    });
  }
  detachState() {
    const oldActions = this.playersArray
      ? this.getActionsState()
      : new Z.Array();
    const oldAvatar = (
      this.playersArray ? this.getAvatarState() : new Z.Map()
    ).toJSON();
    const oldApps = (
      this.playersArray ? this.getAppsState() : new Z.Array()
    ).toJSON();

    // XXX need to unbind listeners when calling this

    return {
      oldActions,
      oldAvatar,
      oldApps,
    };
  }
  attachState(oldState) {
    const { oldActions, oldAvatar, oldApps } = oldState;

    const self = this;
    // console.log('set players array', self.playersArray?.toJSON());
    this.playersArray.doc.transact(function tx() {
      self.playerMap = new Z.Map();

      self.playerMap.set('playerId', self.playerId);

      // console.log('set player map', self.playerMap, self.playerMap?.toJSON(), self.playersArray?.toJSON());

      /* const packed = new Float32Array(11);
      const pack3 = (v, i) => {
        packed[i] = v.x;
        packed[i + 1] = v.y;
        packed[i + 2] = v.z;
      };
      const pack4 = (v, i) => {
        packed[i] = v.x;
        packed[i + 1] = v.y;
        packed[i + 2] = v.z;
        packed[i + 3] = v.w;
      }; */
      const avatar = self.getAvatarState();
      /* // console.log(self.position)
      pack3(self.position, 0);
      pack4(self.quaternion, 3);
      pack3(self.scale, 7);
      
      self.playerMap.set('transform', packed); */

      const actions = self.getActionsState();
      if(actions.length > 0 ) console.log(actions)
      for (const oldAction of oldActions) {
        actions.push([oldAction]);
      }

      const {instanceId} = oldAvatar;
      if (instanceId !== undefined) {
        avatar.set("instanceId", instanceId);
      }

      const apps = self.getAppsState();
      for (const oldApp of oldApps) {
        const mapApp = new Z.Map();
        for (const k in oldApp) {
          const v = oldApp[k];
          mapApp.set(k, v);
        }
        apps.push([mapApp]);
      }

      self.playersArray.push([self.playerMap]);
    });

    this.appManager.bindStateLocal(this.getAppsState());
  }
  grab(app, hand = "left") {
    const renderer = getRenderer();
    const localPlayer = metaversefile.useLocalPlayer();
    const { position, quaternion } = renderer.xr.getSession()
      ? localPlayer[hand === "left" ? "leftHand" : "rightHand"]
      : camera;

    app.updateMatrixWorld();
    app.savedRotation = app.rotation.clone();
    app.startQuaternion = quaternion.clone();

    const grabAction = {
      type: "grab",
      hand,
      instanceId: app.instanceId,
      matrix: localMatrix
        .copy(app.matrixWorld)
        .premultiply(
          localMatrix2
            .compose(position, quaternion, localVector.set(1, 1, 1))
            .invert()
        )
        .toArray(),
    };
    localPlayer.addAction(grabAction);

    const physicsObjects = app.getPhysicsObjects();
    for (const physicsObject of physicsObjects) {
      //physx.physxWorker.disableGeometryPhysics(physx.physics, physicsObject.physicsId);
      physx.physxWorker.disableGeometryQueriesPhysics(
        physx.physics,
        physicsObject.physicsId
      );
    }

    app.dispatchEvent({
      type: "grabupdate",
      grab: true,
    });
  }
  ungrab() {
    const actions = Array.from(this.getActionsState());
    let removeOffset = 0;
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.type === "grab") {
        const app = metaversefile.getAppByInstanceId(action.instanceId);
        const physicsObjects = app.getPhysicsObjects();
        for (const physicsObject of physicsObjects) {
          //physx.physxWorker.enableGeometryPhysics(physx.physics, physicsObject.physicsId);
          physx.physxWorker.enableGeometryQueriesPhysics(
            physx.physics,
            physicsObject.physicsId
          );
        }
        this.removeActionIndex(i + removeOffset);
        removeOffset -= 1;

        app.dispatchEvent({
          type: "grabupdate",
          grab: false,
        });
      }
    }
  }
  /* lookAt(p) {
    const cameraOffset = cameraManager.getCameraOffset();
    camera.position.add(localVector.copy(cameraOffset).applyQuaternion(camera.quaternion));
    camera.quaternion.setFromRotationMatrix(
      localMatrix.lookAt(
        camera.position,
        p,
        localVector2.set(0, 1, 0)
      )
    );
    camera.position.sub(localVector.copy(cameraOffset).applyQuaternion(camera.quaternion));
    camera.updateMatrixWorld();
  } */
  packed = new Float32Array(11);
  lastTimestamp = NaN;

  pushPlayerUpdates(timeDiff) {
    this.playersArray.doc.transact(() => {
      const packed = this.packed;
      const pack3 = (v, i) => {
        packed[i] = v.x;
        packed[i + 1] = v.y;
        packed[i + 2] = v.z;
      };
      const pack4 = (v, i) => {
        packed[i] = v.x;
        packed[i + 1] = v.y;
        packed[i + 2] = v.z;
        packed[i + 3] = v.w;
      };

      pack3(this.position, 0);
      pack4(this.quaternion, 3);
      pack3(this.scale, 7);
      packed[10] = timeDiff;

      this.playerMap.set("transform", packed);
    }, "push");

    // this.appManager.updatePhysics();
  }
  getSession() {
    const renderer = getRenderer();
    const session = renderer.xr.getSession();
    return session;
  }
  updatePhysics(timestamp, timeDiff) {
    if (this.avatar) {
      const timeDiffS = timeDiff / 1000;
      this.characterPhysics.update(timestamp, timeDiffS);
    }
  }
  updateAvatar(timestamp, timeDiff) {
    if (this.avatar) {
      const timeDiffS = timeDiff / 1000;

      const actions = this.getActionsState();
      this.characterSfx.update(timestamp, timeDiffS, actions);
      this.characterFx.update(timestamp, timeDiffS);
      this.characterBehavior.update(timestamp, timeDiffS);

      this.updateInterpolation(timeDiff);

      const session = this.getSession();
      const mirrors = metaversefile.getMirrors();
      applyPlayerToAvatar(this, session, this.avatar, mirrors);

      this.avatar.update(timestamp, timeDiff, true);
      this.characterHups?.update(timestamp);
    }
    this.updateWearables();
  }
  updateWearables() {
    this.wornApps.forEach(app => {
      app.dispatchEvent({
        type: 'wearupdate',
        player: this,
        app,
        wear: true
      });
    })
  }
  resetPhysics() {
    this.characterPhysics.reset();
  }
  teleportTo = (() => {
    const localVector = new THREE.Vector3();
    const localVector2 = new THREE.Vector3();
    const localQuaternion = new THREE.Quaternion();
    const localMatrix = new THREE.Matrix4();
    return function (position, quaternion, { relation = "floor" } = {}) {
      const renderer = getRenderer();
      const xrCamera = renderer.xr.getSession()
        ? renderer.xr.getCamera(camera)
        : camera;

      const avatarHeight = this.avatar ? this.avatar.height : 0;
      if (renderer.xr.getSession()) {
        localMatrix
          .copy(xrCamera.matrix)
          .premultiply(dolly.matrix)
          .decompose(localVector, localQuaternion, localVector2);

        dolly.matrix
          .premultiply(
            localMatrix.makeTranslation(
              position.x - localVector.x,
              position.y - localVector.y,
              position.z - localVector.z
            )
          )
          // .premultiply(localMatrix.makeRotationFromQuaternion(localQuaternion3.copy(quaternion).inverse()))
          // .premultiply(localMatrix.makeTranslation(localVector.x, localVector.y, localVector.z))
          .premultiply(
            localMatrix.makeTranslation(
              0,
              relation === "floor" ? avatarHeight : 0,
              0
            )
          )
          .decompose(dolly.position, dolly.quaternion, dolly.scale);
        dolly.updateMatrixWorld();
      } else {
        camera.position
          .copy(position)
          .sub(
            localVector
              .copy(cameraManager.getCameraOffset())
              .applyQuaternion(camera.quaternion)
          );
        camera.position.y += relation === "floor" ? avatarHeight : 0;
        camera.quaternion.copy(quaternion);
        camera.updateMatrixWorld();
      }

      this.resetPhysics();
    };
  })();
  destroy() {
    this.characterPhysics.destroy();
    this.characterHups.destroy();
    this.characterSfx.destroy();
    this.characterFx.destroy();
    this.characterBehavior.destroy();

    super.destroy();
  }
}

let initialPosition = localVector;
class RemotePlayer extends InterpolatedPlayer {
  audioWorkletNode = false
  constructor(opts) {
    super(opts);
    this.audioWorkletNode = null

    this.isRemotePlayer = true;

    this.characterPhysics = new CharacterPhysics(this);
    this.characterHups = new CharacterHups(this);
    this.characterSfx = new CharacterSfx(this);
    this.characterFx = new CharacterFx(this);
    this.characterBehavior = new CharacterBehavior(this);

    console.log('new remote plater', this);
    }

  audioWorkerLoaded = false
  analyzer = false
  dataArray
  async prepareAudioWorker() {
    try {
    if (!this.audioWorkerLoaded) {
      console.log("preparing audio worker");
      this.audioWorkerLoaded = true;

      await ensureAudioContext();
      const audioContext = getAudioContext();

      this.audioWorkletNode = new AudioWorkletNode(audioContext, 'ws-output-worklet');
      
      this.audioDecoder = new WsAudioDecoder({
        output: data => {
          const buffer = getAudioDataBuffer(data);
          console.log("Posting message to worklet");
          this.audioWorkletNode.port.postMessage(buffer, [buffer.buffer]);
        }
      });

      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 2048;

      var bufferLength = this.analyser.frequencyBinCount;
this.dataArray = new Uint8Array(bufferLength);

      // Connect the source to be analysed
      this.audioWorkletNode.connect(this.analyser);
      // audioWorkletNode.connect(audioContext.destination)
      this.analyser.connect(audioContext.gain);
      console.log("***** EVERYTHING IS CONNECTED *****")
    }
  } catch (error){
    console.error("error", error)
    debugger;
  }
  }

  processAudioData(data) {
    console.log("processing audio data")
    this.prepareAudioWorker();
    if (this.audioWorkletNode){
      this.audioDecoder.decode(data.data);
      this.analyser.getByteTimeDomainData(this.dataArray);
      console.log("this.analyzer", this.dataArray)


    }
  }

  detachState() {
    const oldActions = this.playersArray
      ? this.getActionsState()
      : new Z.Array();
    const oldAvatar = (
      this.playersArray ? this.getAvatarState() : new Z.Map()
    ).toJSON();
    const oldApps = (
      this.playersArray ? this.getAppsState() : new Z.Array()
    ).toJSON();
    
    // XXX need to unbind listeners when calling this
    
    return {
      oldActions,
      oldAvatar,
      oldApps,
    };
  }
  updateAvatar(timestamp, timeDiff) {
    if (this.avatar) {
      const timeDiffS = timeDiff / 1000;
      this.characterSfx?.update(timestamp, timeDiffS);
      this.characterFx?.update(timestamp, timeDiffS);

      this.updateInterpolation(timeDiff);
      const mirrors = metaversefile.getMirrors();
      applyPlayerToAvatar(this, null, this.avatar, mirrors);

      this.avatar.update(timestamp, timeDiff, false);
      this.characterHups?.update(timestamp);
    }
  }
  updatePhysics = () => {}; // LocalPlayer.prototype.updatePhysics;
  getSession() {
    return null;
  }
  attachState(oldState) {
    console.log("oldState is", oldState);
    let index = -1;
    for (let i = 0; i < this.playersArray.length; i++) {
      const player = this.playersArray.get(i, Z.Map);
      if (player.get("playerId") === this.playerId) {
        index = i;
        break;
      }
    }

    if (index !== -1) {
      this.playerMap = this.playersArray.get(index, Z.Map);
    } else {
      console.warn(
        "binding to nonexistent player object",
        this.playersArray.toJSON()
      );
    }

    console.log("index is", index);

    const lastPosition = new THREE.Vector3();

    loadPhysxCharacterController.call(this);

    // let prevApps = [];

    const observePlayerFn = (e) => {
      if (e.changes.keys.get("playerId")) {
        console.log("playerId is ", e.changes.keys.get("playerId"));
      }

      if (e.changes.keys.get("avatar")) {
        console.log("avatar is ", e.changes.keys.get("avatar"));
        // TODO: Handle attaching the remote
      }

      if (e.changes.keys.get("transform")) {
        const transform = this.playerMap.get("transform");
        if (transform) {
          const remoteTimeDiff = transform[10];
          lastPosition.copy(this.position);
          this.position.fromArray(transform, 0);

          if (this.avatar) this.characterPhysics.setPosition(this.position);

          this.quaternion.fromArray(transform, 3);

          this.positionInterpolant?.snapshot(remoteTimeDiff);
          this.quaternionInterpolant?.snapshot(remoteTimeDiff);

          for (const actionBinaryInterpolant of this.actionBinaryInterpolantsArray) {
            actionBinaryInterpolant.snapshot(remoteTimeDiff);
          }

          if (this.avatar) {
            this.avatar.setVelocity(
              remoteTimeDiff / 1000,
              lastPosition,
              this.position,
              this.quaternion
            );
          }
        }
      }
      
      this.wornApps.forEach(app => {
        app.dispatchEvent({
          type: 'wearupdate',
          player: this,
          app,
          wear: true
        });
      })
    };

    this.playerMap.observe(observePlayerFn);
    this.unbindFns.push(
      this.playerMap.unobserve.bind(this.playerMap, observePlayerFn)
    );

    this.appManager.bindStateRemote(this.getAppsState());
    this.appManager.loadApps();
    this.appManager.callBackFn = (app, event, flag) => {
      if (event == "wear") {
        console.log("********* WEAR -- ", app, event, flag)
        if (flag === "remove") {
          this.unwear(app);
        } if (flag === "add") {
          this.wear(app);
        }
      }
    };

    this.syncAvatar();
  }

  destroy() {
    this.characterPhysics.destroy();
    this.characterHups.destroy();
    this.characterSfx.destroy();
    this.characterFx.destroy();
    this.characterBehavior.destroy();

    super.destroy();
  }

  getSession() {
    const renderer = getRenderer();
    const session = renderer.xr.getSession();
    return session;
  }
}
class StaticUninterpolatedPlayer extends PlayerBase {
  constructor(opts) {
    super(opts);

    UninterpolatedPlayer.init.apply(this, arguments);

    this.actions = [];
  }
  getActionsState() {
    return this.actions;
  }
  getActions() {
    return this.actions;
  }
  getActionsArray() {
    return this.actions;
  }
  getAction(type) {
    return this.actions.find((action) => action.type === type);
  }
  getActionByActionId(actionId) {
    return this.actions.find((action) => action.actionId === actionId);
  }
  hasAction(type) {
    return this.actions.some((a) => a.type === type);
  }
  addAction(action) {
    this.actions.push(action);

    this.dispatchEvent({
      type: "actionadd",
      action,
    });
  }
  removeAction(type) {
    for (let i = 0; i < this.actions.length; i++) {
      const action = this.actions[i];
      if (action.type === type) {
        this.removeActionIndex(i);
        break;
      }
    }
  }
  removeActionIndex(index) {
    const action = this.actions.splice(index, 1)[0];
    this.dispatchEvent({
      type: "actionremove",
      action,
    });
  }
  clearActions() {
    const numActions = this.actions.length;
    for (let i = numActions - 1; i >= 0; i--) {
      this.removeActionIndex(i);
    }
  }
  updateInterpolation = UninterpolatedPlayer.prototype.updateInterpolation;
}
class NpcPlayer extends StaticUninterpolatedPlayer {
  constructor(opts) {
    super(opts);

    this.isNpcPlayer = true;
    this.avatarApp = null;

    this.characterPhysics = new CharacterPhysics(this);
    this.characterHups = new CharacterHups(this);
    this.characterSfx = new CharacterSfx(this);
    this.characterFx = new CharacterFx(this);
    this.characterBehavior = new CharacterBehavior(this);
  }
  getAvatarApp() {
    return this.avatarApp;
  }
  setAvatarApp(app) {
    app.toggleneUpdates(true);
    const { skinnedVrm } = app;
    const avatar = new Avatar(skinnedVrm, {
      fingers: true,
      hair: true,
      visemes: true,
      debug: false,
    });

    unFrustumCull(app);
    enableShadows(app);

    this.avatar = avatar;

    this.characterPhysics = this.characterPhysics ?? new CharacterPhysics(this);
    this.characterHups = this.characterHups ?? new CharacterHups(this);
    this.characterSfx = this.characterSfx ?? new CharacterSfx(this);
    this.characterFx = this.characterFx ?? new CharacterFx(this);

    this.avatarApp = app;

    loadPhysxCharacterController.call(this);
    // loadPhysxAuxCharacterCapsule.call(this);
  }
  getSession() {
    return null;
  }
  updatePhysics = LocalPlayer.prototype.updatePhysics;
  updateAvatar = LocalPlayer.prototype.updateAvatar;
  /* detachState() {
    return null;
  }
  attachState(oldState) {
    let index = -1;
    for (let i = 0; i < this.playersArray.length; i++) {
      const player = this.playersArray.get(i, Z.Map);
      if (player.get('playerId') === this.playerId) {
        index = i;
        break;
      }
    }
    if (index !== -1) {
      this.playerMap = this.playersArray.get(index, Z.Map);
    } else {
      console.warn('binding to nonexistent player object', this.playersArray.toJSON());
    }
    
    const observePlayerFn = e => {
      this.position.fromArray(this.playerMap.get('position'));
      this.quaternion.fromArray(this.playerMap.get('quaternion'));
    };
    this.playerMap.observe(observePlayerFn);
    this.unbindFns.push(this.playerMap.unobserve.bind(this.playerMap, observePlayerFn));
    
    this.appManager.bindState(this.getAppsState());
    this.appManager.syncApps();
    
    this.syncAvatar();
  } */
  destroy() {
    /* const npcs = metaversefile.useNpcs();
    const index = npcs.indexOf(this);
    if (index !== -1) {
      npcs.splice(index, 1);
    } */

    this.characterPhysics.destroy();
    this.characterHups.destroy();
    this.characterSfx.destroy();
    this.characterFx.destroy();
    this.characterBehavior.destroy();

    if (this.avatarApp) {
      this.avatarApp.toggleBoneUpdates(false);
    }

    super.destroy();
  }
  updateInterpolation = UninterpolatedPlayer.prototype.updateInterpolation;
}

export { LocalPlayer, RemotePlayer, NpcPlayer };
