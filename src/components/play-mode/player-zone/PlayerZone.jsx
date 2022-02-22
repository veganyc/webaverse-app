
import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import metaversefile from 'metaversefile';
import { discordClientId } from '../../../../constants';

import styles from './player-zone.module.css';

//

export const PlayerZone = ({ username, loginInState }) => {

    const localPlayer = metaversefile.useLocalPlayer();
    const [ loginMenuOpened, setLoginMenuOpened ] = useState( false );

    //

    const stopPropagation = ( event ) => {

        event.stopPropagation();

    };

    const handleLoginsWrapperBtnClick = () => {

        setLoginMenuOpened( true );

    };

    const handleMetamaskBtnClick = () => {

        // todo

    };

    const handleOnFocusLost = () => {

        setLoginMenuOpened( false );

    };

    //

    useEffect( () => {

        window.addEventListener( 'click', handleOnFocusLost );

        //

        return () => {

            window.removeEventListener( 'click', handleOnFocusLost );

        };

    }, [] );

    //

    return (
        <div className={ styles.playerZone } onClick={ stopPropagation } >

            {
                ( loginInState === 'in-progress' ) ?(
                    <div className={ styles.loginBtnWrapper } >Login in...</div>
                ) : (
                    ( loginInState === 'done' ) ? (
                        <div className={ styles.avatar } />
                    ) : (
                        <div className={ styles.loginBtnWrapper } onClick={ handleLoginsWrapperBtnClick } >Login</div>
                    )
                )
            }

            <div className={ classNames( styles.loginBtnsWrapper, loginMenuOpened ? styles.opened : null ) } >
                <div className={ styles.loginBtn } onClick={ handleMetamaskBtnClick } >
                    <div className={ styles.loginBtnText } >
                        <img className={ styles.loginBtnImg } src="images/metamask.png" alt="metamask" width="28px" />
                        <span>MetaMask</span>
                    </div>
                </div>
                <a className={ styles.loginBtn } style={{ marginTop: '10px' }} href={ `https://discord.com/api/oauth2/authorize?client_id=${ discordClientId }&redirect_uri=${ window.location.origin }%2Flogin&response_type=code&scope=identify` } >
                    <div className={ styles.loginBtnText } >
                        <img className={ styles.loginBtnImg } src="images/discord-dark.png" alt="discord" width="28px" />
                        <span>Discord</span>
                    </div>
                </a>
            </div>

            <div className={ styles.username }>{ username }</div>

            <div className={ classNames( styles.progressBar, styles.manaBar ) } >
                <div className={ styles.progressBarFill } />
            </div>

            <div className={ classNames( styles.progressBar, styles.healthBar ) } >
                <div className={ styles.progressBarFill } />
            </div>

        </div>
    );

};
