
import React, { useState } from 'react';

import { CharacterOverview } from './character-overview';
import { Settings } from './settings';
import { ActionMenu } from './action-menu';
import { LocationMenu } from './location-menu';
import { Inventory } from './inventory';
import { Hotbar } from './hotbar';
import { PlayerZone } from './player-zone';
import { Chat } from './chat/Chat';

import styles from './play-mode.module.css';

//

export const PlayMode = ({ setLoginOpenPopupOpened, loginInState, username }) => {

    const [ characterOverviewOpened, setCharacterOverviewOpened ] = useState( false );
    const [ settingsOpened, setSettingsOpened ] = useState( false );

    //

    return (
        <div className={ styles.playMode }>
            <CharacterOverview opened={ characterOverviewOpened } setOpened={ setCharacterOverviewOpened } />
            <Settings opened={ settingsOpened } setOpened={ setSettingsOpened } />
            <ActionMenu openSettings={ setSettingsOpened } />
            <LocationMenu />
            <Inventory openCharacterOverview={ setCharacterOverviewOpened } />
            <Hotbar />
            <PlayerZone username={ username } setLoginOpenPopupOpened={ setLoginOpenPopupOpened } loginInState={ loginInState } />
            <Chat />
        </div>
    );

};
