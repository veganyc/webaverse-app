
import React from 'react';

import { Minimap } from './minimap';
import { Hotbar } from './hotbar';
import { Inventory } from './inventory';
import { PlayerZone } from './player-zone';
import { CharacterOverview } from './character-overview';

import styles from './play-mode.module.css';

//

export const PlayMode = ({ characterOverviewOpened, setCharacterOverviewOpened }) => {

    //

    return (
        <div className={ styles.playMode }>
            <PlayerZone username={ '' } loginInState={ false } setLoginOpenPopupOpened={ null } />
            <Minimap />
            <Hotbar />
            <Inventory />
            <CharacterOverview opened={ characterOverviewOpened } setOpened={ setCharacterOverviewOpened } />
        </div>
    );

};
