import React, { PropTypes } from 'react';
import {
    StyleSheet,
    View,
    TouchableHighlight,
    Animated,
    Easing
} from 'react-native';

import {
    applySimpleTension,
    isValidHorizontalGestureAngle,
    isValidHorizontalGesture
} from '../util/gesture';
import {
    getLayout,
    getWidth,
    getHeight
} from '../util/layout';
import {
    GESTURE_DISTANCE_THRESHOLD,
    OPEN_POSITION_THRESHOLD_FACTOR,
    CLOSE_POSITION_THRESHOLD_FACTOR,
    OPEN_VELOCITY_THRESHOLD,
    MAX_OPEN_THRESHOLD,
    OPEN_TENSION_THRESHOLD
} from '../constants';
import HorizontalGestureResponder from './HorizontalGestureResponder';
import isFinite from 'lodash/isFinite';

const SubViewOptionsShape = {
    fullWidth: PropTypes.bool,
    closeOnClick: PropTypes.bool
};

const defaultSubViewOptions = {
    fullWidth: false,
    closeOnClick: true
};

const SwipeRow = React.createClass({

    propTypes: {
        style: View.propTypes.style,
        id: PropTypes.oneOfType([
            PropTypes.number,
            PropTypes.string
        ]).isRequired,
        rowViewStyle: View.propTypes.style,
        gestureTensionParams: PropTypes.shape({
            threshold: PropTypes.number,
            stretch: PropTypes.number,
            resistanceStrength: PropTypes.number
        }),
        onGestureStart: PropTypes.func,
        swipeEnabled: PropTypes.bool,
        onSwipeStart: PropTypes.func,
        onSwipeUpdate: PropTypes.func,
        onSwipeEnd: PropTypes.func,
        onOpen: PropTypes.func,
        onClose: PropTypes.func,
        onCapture: PropTypes.func,
        leftSubView: PropTypes.element,
        rightSubView: PropTypes.element,
        leftSubViewOptions: PropTypes.shape(SubViewOptionsShape),
        rightSubViewOptions: PropTypes.shape(SubViewOptionsShape),
        startOpen: PropTypes.bool,
        blockChildEventsWhenOpen: PropTypes.bool,
        isAnotherRowOpen: PropTypes.func,
        closeOnPropUpdate: PropTypes.bool,
        animateRemoveSpeed: PropTypes.number
    },

    getDefaultProps() {
        return {
            swipeEnabled: true,
            blockChildEventsWhenOpen: true,
            leftSubViewOptions: defaultSubViewOptions,
            rightSubViewOptions: defaultSubViewOptions,
            closeOnPropUpdate: false,
            gestureTensionParams: {},
            animateRemoveSpeed: 150,
            isAnotherRowOpen: () => false,
            onGestureStart: () => {},
            onSwipeStart: () => {},
            onSwipeUpdate: () => {},
            onSwipeEnd: () => {},
            onOpen: () => {},
            onClose: () => {}
        };
    },

    getInitialState() {
        return {
            pan: new Animated.ValueXY(),
            heightAnim: new Animated.Value(0),
            heightAnimating: false,
            activeSide: null,
            open: false
        };
    },

    componentWillReceiveProps(nextProps) {
        if (!this.props.animateAdd && nextProps.animateAdd) {
            this.setState({
                heightAnimating: true

            });
            this.state.heightAnim.setValue(0);
            Animated.timing(
                this.state.heightAnim,
                {
                    toValue: this.state.rowHeight,
                    duration: this.props.animateRemoveSpeed,
                    easing: Easing.in(Easing.cubic)
                }
            ).start(this.resetState);
        }
        else if (this.props.id !== nextProps.id) {
            this.clearCloseTimeout();
            this.resetState();
        }
        this.props.closeOnPropUpdate && this.close();
    },

    componentWillUpdate(nextProps, nextState) {
        this.checkHandleSubViewWidthUpdate(nextState);
    },

    componentWillUnmount() {
        this.clearCloseTimeout();
    },

    resetState() {
        this.setState(this.getInitialState());
    },

    checkHandleSubViewWidthUpdate(nextState) {
        let updateLeft = this.state.leftSubViewWidth !== nextState.leftSubViewWidth && nextState.leftSubViewWidth >= 0;
        let updateRight = this.state.rightSubViewWidth !== nextState.rightSubViewWidth && nextState.rightSubViewWidth >= 0;
        if (nextState.open && !nextState.heightAnimating && (updateLeft || updateRight)) {
            let activeSide = nextState.activeSide;
            let position = activeSide === 'left' ? nextState.leftSubViewWidth : nextState.rightSubViewWidth;
            this.animateOpenOrClose(position, 15, true);
        }
    },

    animateOut(onComplete) {
        this.state.heightAnim.setValue(this.state.rowHeight);
        this.setState({
            heightAnimating: true
        });
        Animated.timing(
            this.state.heightAnim,
            {
                toValue: 0,
                duration: this.props.animateRemoveSpeed,
                easing: Easing.in(Easing.cubic)
            }
        ).start(onComplete);
    },

    onSwipeStart(e, g) {
        // Allow quicker left/right gestures by resetting the active side
        if (Math.abs(this.state.pan.x._value) < 0.5) {
            this.setState({
                activeSide: null
            });
        }
        this.props.onSwipeStart(this, e, g);
        this.state.pan.stopAnimation();
        let offsetX = this.state.pan.x._value || 0;
        this.state.pan.setOffset({ x: offsetX, y: 0 });
        this.state.pan.setValue({ x: 0, y: 0 });
        this.clearCloseTimeout();
    },

    onSwipeUpdate(e, g) {
        let { dx } = g;
        this.props.onSwipeUpdate(this, e, g);
        this.state.open ? this.updatePanPosition(dx) : this.handleSwipeWhenClosed(dx);
    },

    onSwipeEnd(e, g) {
        let { dx, vx } = g;
        this.props.onSwipeEnd(this, e, g);
        this.state.pan.flattenOffset();
        if (this.state.open) {
            this.checkAnimateOpenOrClose(dx, vx);
        }
        else if (this.state.activeSide === 'left' && dx > 0 || this.state.activeSide === 'right' && dx < 0){
            this.checkAnimateOpenOrClose(dx, vx);
        }
        else {
            this.setState({
                activeSide: null
            });
        }
    },

    handleSwipeWhenClosed(dx) {
        if (dx >= 0) {
            if (!this.state.activeSide && this.props.leftSubView) {
                this.setState({
                    activeSide: 'left'
                });
            }
            this.updatePanPosition(dx);
        }
        else if (dx <= 0) {
            if (!this.state.activeSide && this.props.rightSubView) {
                this.setState({
                    activeSide: 'right'
                });
            }
            this.updatePanPosition(dx);
        }

    },

    updatePanPosition(dx) {
        let relativeDX = this.getRelativeDX(dx);
        let absOffset = Math.abs(this.state.pan.x._offset);
        if (this.state.activeSide === 'left') {
            let threshold = (this.state.leftSubViewWidth - absOffset);
            dx = relativeDX >= threshold ? dx : -(this.state.leftSubViewWidth - threshold);
            if (dx > 0) {
                dx = this.applyTensionToGesture(dx);
            }
            this.setPanPosition(dx);
        }
        else if (this.state.activeSide === 'right') {
            let threshold = (this.state.rightSubViewWidth - absOffset);
            dx = relativeDX >= threshold ? dx : (this.state.rightSubViewWidth - threshold);
            if (dx < 0) {
                dx = this.applyTensionToGesture(dx);
            }
            this.setPanPosition(dx);
        }
    },

    getRelativeDX(dx) {
        if (this.state.activeSide === 'left') {
            return dx + this.state.leftSubViewWidth;
        }
        else if (this.state.activeSide === 'right') {
            return this.state.rightSubViewWidth - dx;
        }
    },

    setPanPosition(dx) {
        if (isFinite(dx)) {
            this.state.pan.setValue({ x: dx, y: 0 });
        }
    },

    applyTensionToGesture(dx) {
        let tensionParams = this.props.gestureTensionParams;
        let tensionThreshold = this.state.open
            ? OPEN_TENSION_THRESHOLD
            : (tensionParams.threshold || this.getActiveSubViewWidth());
        return applySimpleTension(
            dx,
            tensionThreshold,
            tensionParams.stretch,
            tensionParams.resistanceStrength
        );
    },

    checkAnimateOpenOrClose(dx, vx) {
        if ((Math.abs(dx) <= GESTURE_DISTANCE_THRESHOLD) && this.state.open) {
            this.animateOpenOrClose(0, vx);
        }
        else {
            this.checkOpenOrClose(dx, vx);
        }
    },

    checkOpenOrClose(dx, vx) {
        let isLeft = this.state.activeSide === 'left';
        let openPosition = this.getActiveSubViewOpenPosition();
        let toValue;
        let isOpen;
        if (this.state.open) {
            let pastClosedThreshold = this.isPastCloseThreshold(dx, vx);
            if ((dx > 0 && isLeft) || (dx < 0 && !isLeft)) {
                isOpen = true;
                toValue = openPosition;
            }
            else {
                isOpen = !pastClosedThreshold;
                toValue = pastClosedThreshold ? 0 : openPosition;
            }
        }
        else {
            let pastOpenThreshold = this.isPastOpenThreshold(dx, vx);
            isOpen = pastOpenThreshold;
            toValue = pastOpenThreshold ? openPosition : 0;
        }
        this.animateOpenOrClose(toValue, vx);
    },

    isPastOpenThreshold(dx, vx) {
        if (dx > 0 && this.props.leftSubView || dx < 0 && this.props.rightSubView) {
            let thresholdBase = this.getActiveSubViewWidth() * OPEN_POSITION_THRESHOLD_FACTOR;
            let absVX = Math.abs(vx);
            let velocityMod = (absVX * (thresholdBase * 2));
            let threshold = thresholdBase - velocityMod;
            return Math.abs(dx) >= Math.min(threshold, MAX_OPEN_THRESHOLD);
        }

        return false;
    },

    isPastCloseThreshold(dx, vx) {
        let thresholdBase = this.getActiveSubViewWidth() * CLOSE_POSITION_THRESHOLD_FACTOR;
        let absVX = Math.abs(vx);
        let velocityMod = (absVX * (thresholdBase * 2));
        let threshold = thresholdBase - velocityMod;
        return Math.abs(dx) >= threshold;
    },

    close(skipAnimation) {
        if (this.state.open) {
            this.clearCloseTimeout();
            if (skipAnimation) {
                this.setState({ pan: new Animated.ValueXY() });
            }
            else {
                this.animateOpenOrClose(0, 1.75, true);
            }
            this.props.onClose(this);
        }
    },

    open(side, skipAnimation) {
        if (!this.state.open) {
            this.clearCloseTimeout();
            let openPosition = side === 'left' ? this.state.leftSubViewWidth : this.state.rightSubViewWidth;
            if (skipAnimation) {
                this.setState({
                    pan: new Animated.ValueXY({ x: openPosition, y: 0 }),
                    activeSide: side,
                    open: true
                });
            }
            else {
                this.animateOpenOrClose(openPosition, 0.75, true)
            }
            this.props.onOpen(this);
        }
    },

    animateOpenOrClose(toValue, vx, noBounce) {
        let isOpen = toValue !== 0;
        Animated.spring(
            this.state.pan,
            {
                toValue: { x: toValue, y: 0 },
                velocity: vx,
                friction: noBounce ? 8 : 4,
                tension: 22 * Math.abs(vx)
            }
        ).start(() => {
            if (this.state.pan.x._value === 0) {
                this.setState({
                    activeSide: isOpen ? this.state.activeSide : null
                });
            }
        });
        this.setState({
            open: isOpen
        });
        isOpen ? this.props.onOpen(this) : this.props.onClose(this);
    },

    isOpen() {
        return this.state.open;
    },

    getActiveSubViewOpenPosition() {
        return this.state.activeSide === 'left'
            ? this.state.leftSubViewWidth
            : -this.state.rightSubViewWidth;
    },

    getActiveSubViewWidth() {
        return this.state.activeSide === 'left'
            ? this.state.leftSubViewWidth
            : this.state.rightSubViewWidth;
    },

    setRowHeight(e) {
        this.setState({
            rowHeight: getHeight(e)
        });
    },

    setLeftSubViewWidth(e) {
        let width = getWidth(e);
        if (width !== this.state.leftSubViewWidth) {
            this.setState({ leftSubViewWidth: width });
        }
    },

    setRightSubViewWidth(e) {
        let width = getWidth(e);
        if (width !== this.state.rightSubViewWidth) {
            this.setState({ rightSubViewWidth: width });
        }
    },

    isSwipeable() {
        return !!(this.props.leftSubView || this.props.rightSubView) && this.props.swipeEnabled;
    },

    checkSetCloseTimeout(e, g) {
        this.props.onGestureStart(this, e, g);
        if (this.state.open && this.shouldCloseOnClick()) {
            // if the row is open and a gesture comes in and isn't followed by an
            // onResponderStart call we want to close the row
            if (!this.closeTimeout) {
                this.closeTimeout = setTimeout(this.close, 250);
            }
        }
    },

    clearCloseTimeout() {
        clearTimeout(this.closeTimeout);
        this.closeTimeout = null;
    },

    shouldCloseOnClick() {
        return this.state.activeSide === 'left'
            ? this.props.leftSubViewOptions.closeOnClick
            : this.props.rightSubViewOptions.closeOnClick;
    },

    checkCloseOpenRow(e) {
        let shouldCloseRow = this.props.isAnotherRowOpen(this);
        if (shouldCloseRow) {
            e.stopPropagation();
            this.props.tryCloseOpenRow();
        }
        return false;
    },

    render() {
        return (
            <Animated.View style={[styles.container, this.props.style, this.getHeightStyle()]}
                           onLayout={this.setRowHeight}
                           onStartShouldSetResponderCapture={this.checkCloseOpenRow}>
                <HorizontalGestureResponder style={[styles.containerInner]}
                                            enabled={this.isSwipeable()}
                                            onGestureStart={this.checkSetCloseTimeout}
                                            onResponderStart={this.onSwipeStart}
                                            onResponderEnd={this.onSwipeEnd}
                                            onResponderUpdate={this.onSwipeUpdate}>
                    {this.renderSubView()}
                    <Animated.View style={[styles.containerInner, this.props.rowViewStyle, this.state.pan.getLayout()]}
                                   pointerEvents={this.getRowPointerEvents()}>
                        {this.props.children}
                    </Animated.View>
                </HorizontalGestureResponder>
            </Animated.View>
        );
    },

    getHeightStyle() {
        if (this.state.heightAnimating) {
            return {
                height: this.state.heightAnim,
                overflow: 'hidden'
            };
        }
    },

    getRowPointerEvents() {
        return (this.state.open && this.props.blockChildEventsWhenOpen) ? 'none' : 'box-none';
    },

    renderSubView() {
        let activeSide = this.state.activeSide;
        let isLeft = activeSide === 'left';
        let subView = this.getActiveSubView(isLeft);
        let onLayout = this.getActiveSubViewOnLayout(isLeft);
        let activeSideStyle = this.getActiveSideStyle(isLeft);
        let panStyle = this.getSubViewPanStyle(isLeft);
        let wrapperStyle = this.getSubViewWrapperStyle(isLeft);
        if (activeSide) {
            return (
                <Animated.View style={[styles.subViewContainer, activeSideStyle, panStyle]}>
                    <View style={[styles.subViewWrapper, wrapperStyle]} onLayout={onLayout}>
                        {subView}
                    </View>
                </Animated.View>
            );
        }
    },

    getActiveSubView(isLeft) {
        return isLeft ? this.props.leftSubView : this.props.rightSubView;
    },

    getActiveSubViewOnLayout(isLeft) {
        return isLeft ? this.setLeftSubViewWidth : this.setRightSubViewWidth;
    },

    getSubViewWrapperStyle(isLeft) {
        let fullWidth = isLeft ?  this.props.leftSubViewOptions.fullWidth : this.props.rightSubViewOptions.fullWidth;
        let widthKnown  = isLeft ? this.state.leftSubViewWidth : this.state.rightSubViewWidth;
        return {
            opacity: widthKnown ? 1 : 0,
            flex: fullWidth ? 1 : 0
        }
    },

    getActiveSideStyle(isLeft) {
        return isLeft ? styles.leftSubView : styles.rightSubView;
    },

    getSubViewPanStyle() {
        if (this.state.activeSide === 'left' && this.state.leftSubViewWidth) {
            return {
                transform: [{
                    translateX: this.state.pan.x.interpolate({
                        inputRange: [0, this.state.leftSubViewWidth],
                        outputRange: [-this.state.leftSubViewWidth, 0]
                    })
                }]
            };
        }
        else if (this.state.activeSide === 'right' && this.state.rightSubViewWidth) {
            return {
                transform: [{
                    translateX: this.state.pan.x.interpolate({
                        inputRange: [-this.state.rightSubViewWidth, 0],
                        outputRange: [0, this.state.rightSubViewWidth]
                    })
                }]
            };
        }
    }
});

const styles = StyleSheet.create({
    container: {
        alignSelf: 'stretch',
        backgroundColor: 'transparent'
    },
    containerInner: {
        alignSelf: 'stretch'
    },
    subViewContainer: {
        position: 'absolute',
        flexDirection: 'row',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0
    },
    subViewWrapper: {
        flexDirection: 'row',
        alignItems: 'stretch',
        alignSelf: 'stretch'
    },
    fullSubView: {
        flex: 1
    },
    leftSubView: {
        alignItems: 'flex-start'
    },
    rightSubView: {
        justifyContent: 'flex-end'
    }
});


export default SwipeRow;