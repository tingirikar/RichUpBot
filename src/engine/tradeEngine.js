import { GROUP_TILES, BOARD_TILES } from '../data/boardTiles.js';
import { GameMemory } from '../memory/gameMemory.js';
import { OpponentTracker } from '../memory/opponentTracker.js';
import { CONFIG } from '../config.js';

/**
 * GAME-THEORETIC MINIMAX TRADE ENGINE
 * 
 * 1. Evaluates incoming trades using synergy multipliers & cash differentials
 * 2. Scans board for Mutual Monopoly Swaps
 * 3. Prevents giving opponents uncountered monopolies
 * 4. Formulates win-win trades with custom chat pitches
 */
export const TradeEngine = {
    scoreTileForPlayer(tile, playerName) {
        if (!tile) return 0;
        const baseEV = tile.price * (1 + tile.markov * 18);
        if (!tile.group) return baseEV;

        const isMe = GameMemory.isMe(playerName);
        const { owned, total } = GameMemory.getGroupCount(tile.group, isMe ? '__ME__' : playerName);

        let synergy = 1.0;
        if (tile.type === 'property') {
            if (owned >= total - 1) synergy = 6.2; // Massive monopoly synergy
            else if (owned === 1 && total === 3) synergy = 2.0;
        } else if (tile.type === 'airport') {
            synergy = 1.0 + owned * 0.45;
        } else if (tile.type === 'utility') {
            synergy = owned >= 1 ? 1.8 : 0.9;
        }
        return Math.round(baseEV * synergy);
    },

    /**
     * 20-ROUND MONTE CARLO FORWARD TRADE SIMULATION
     * Simulates up to 20 rounds of future dice rolls, rent payments, salary collection,
     * and bankruptcy risk comparing trade ACCEPTED vs REJECTED.
     */
    simulateFutureTradeRounds(tradeData, numRounds = 20, iterations = 80) {
        const {
            partnerName = '__OPP__',
            givenTiles = [],
            receivedTiles = [],
            givenCash = 0,
            receivedCash = 0
        } = tradeData;

        const givenIds = new Set(givenTiles.map(t => t.id));
        const receivedIds = new Set(receivedTiles.map(t => t.id));

        const runTrajectory = (isAccepted) => {
            // Copy ownership state
            const simOwnership = {};
            for (const [id, info] of Object.entries(GameMemory.ownership)) {
                let owner = info.owner;
                if (isAccepted) {
                    if (givenIds.has(Number(id))) owner = partnerName;
                    if (receivedIds.has(Number(id))) owner = GameMemory.myName || '__ME__';
                }
                simOwnership[id] = { owner, houses: info.houses || 0, mortgaged: info.mortgaged || false };
            }

            let myCash = isAccepted ? (GameMemory.myCash - givenCash + receivedCash) : GameMemory.myCash;
            let oppBase = GameMemory.players[partnerName]?.cash ?? 500;
            let oppCash = isAccepted ? (oppBase - receivedCash + givenCash) : oppBase;

            let myPos = GameMemory.myPos || 0;
            let oppPos = GameMemory.players[partnerName]?.pos || 0;

            let myBankrupt = myCash < 0;
            let oppBankrupt = oppCash < 0;

            for (let r = 1; r <= numRounds; r++) {
                // Player My Turn
                if (!myBankrupt) {
                    const roll = Math.floor(Math.random() * 6 + 1) + Math.floor(Math.random() * 6 + 1);
                    const newPos = (myPos + roll) % 40;
                    if (newPos < myPos) myCash += 200; // Salary for passing GO
                    myPos = newPos;

                    const tile = BOARD_TILES[myPos];
                    if (tile?.group) {
                        const info = simOwnership[tile.id];
                        if (info?.owner === partnerName && !info.mortgaged) {
                            let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                            if (tile.type === 'property' && tile.rent) {
                                rent = tile.rent[info.houses || 0] || tile.rent[0];
                            } else if (tile.type === 'airport') {
                                const count = Object.values(simOwnership).filter(x => x.owner === partnerName && BOARD_TILES[x.id]?.type === 'airport').length;
                                rent = 25 * Math.pow(2, Math.max(0, count - 1));
                            }
                            myCash -= rent;
                            oppCash += rent;
                            if (myCash < 0) myBankrupt = true;
                        }
                    }
                }

                // Opponent Turn
                if (!oppBankrupt) {
                    const roll = Math.floor(Math.random() * 6 + 1) + Math.floor(Math.random() * 6 + 1);
                    const newPos = (oppPos + roll) % 40;
                    if (newPos < oppPos) oppCash += 200;
                    oppPos = newPos;

                    const tile = BOARD_TILES[oppPos];
                    if (tile?.group) {
                        const info = simOwnership[tile.id];
                        if (info && GameMemory.isMe(info.owner) && !info.mortgaged) {
                            let rent = tile.price ? Math.round(tile.price * 0.1) : 20;
                            if (tile.type === 'property' && tile.rent) {
                                rent = tile.rent[info.houses || 0] || tile.rent[0];
                            } else if (tile.type === 'airport') {
                                const count = Object.values(simOwnership).filter(x => GameMemory.isMe(x.owner) && BOARD_TILES[x.id]?.type === 'airport').length;
                                rent = 25 * Math.pow(2, Math.max(0, count - 1));
                            }
                            oppCash -= rent;
                            myCash += rent;
                            if (oppCash < 0) oppBankrupt = true;
                        }
                    }
                }
            }

            return { myCash, oppCash, mySurvive: !myBankrupt, oppSurvive: !oppBankrupt };
        };

        let accSurvivals = 0, accCashSum = 0;
        let rejSurvivals = 0, rejCashSum = 0;

        for (let i = 0; i < iterations; i++) {
            const acc = runTrajectory(true);
            if (acc.mySurvive) accSurvivals++;
            accCashSum += acc.myCash;

            const rej = runTrajectory(false);
            if (rej.mySurvive) rejSurvivals++;
            rejCashSum += rej.myCash;
        }

        const accSurvRate = Math.round((accSurvivals / iterations) * 100);
        const rejSurvRate = Math.round((rejSurvivals / iterations) * 100);
        const accAvgCash = Math.round(accCashSum / iterations);
        const avgRejCash = Math.round(rejCashSum / iterations);

        return {
            simulatedRounds: numRounds,
            iterations,
            accSurvRate,
            rejSurvRate,
            accAvgCash,
            avgRejCash,
            isSimulationEVPlus: accAvgCash >= avgRejCash && accSurvRate >= (rejSurvRate - 10)
        };
    },

    findCounterTrade(tradeData) {
        const { partnerName, givenTiles = [], receivedTiles = [] } = tradeData;
        if (!partnerName || partnerName === 'Opponent') return null;

        const myMissing = OpponentTracker.getMyMissingCards();
        const partnerMissingCard = myMissing.find(m => m.heldBy && m.heldBy.toLowerCase() === partnerName.toLowerCase());

        if (partnerMissingCard && partnerMissingCard.missingTile) {
            // Find a tile to offer: prefer the tile they asked for, or an unmortgaged safe sacrifice
            const requestedTile = givenTiles[0] || OpponentTracker.getSafeTradeSacrifices()[0]?.tile;
            if (requestedTile) {
                const oppSet = requestedTile.group ? GameMemory.getGroupCount(requestedTile.group, partnerName) : null;
                const givesThemMonopoly = oppSet && oppSet.owned === oppSet.total - 1;

                const oppCash = GameMemory.players[partnerName]?.cash ?? 500;
                let cashDemand = 0;
                if (givesThemMonopoly) {
                    cashDemand = Math.max(80, Math.min(Math.max(0, oppCash - 50), 150));
                }

                const cashDemandStr = cashDemand > 0 ? ` + $${cashDemand}` : '';
                return {
                    targetOwner: partnerName,
                    myGivenTile: requestedTile,
                    myReceivedTile: partnerMissingCard.missingTile,
                    cashOffer: 0,
                    cashDemand,
                    summary: `COUNTER: Give ${requestedTile.name} -> Get ${partnerMissingCard.missingTile.name}${cashDemandStr}`,
                    pitch: `counter: ${partnerMissingCard.missingTile.name.toLowerCase()} for ${requestedTile.name.toLowerCase()}`,
                    reason: `Grandmaster Counter-Proposal: Securing ${partnerMissingCard.missingTile.name} to complete our ${partnerMissingCard.missingTile.group} Monopoly!`
                };
            }
        }
        return null;
    },

    evaluateIncomingTrade(tradeData) {
        const {
            partnerName = '__OPP__',
            givenTiles = [],
            receivedTiles = [],
            givenCash = 0,
            receivedCash = 0
        } = tradeData;

        // VETO CHECK 1: Never hand an opponent a monopoly unless we also receive a monopoly
        let givesOppMonopoly = false;
        let oppGroupName = '';
        let givenBlockerTile = null;

        for (const tile of givenTiles) {
            if (tile.group && tile.type === 'property') {
                const oppSet = GameMemory.getGroupCount(tile.group, partnerName);
                if (oppSet.owned === oppSet.total - 1) {
                    givesOppMonopoly = true;
                    oppGroupName = tile.group;
                    givenBlockerTile = tile;
                    break;
                }
            }
        }

        let completesMyMonopoly = false;
        let myCompletedGroup = '';
        for (const tile of receivedTiles) {
            if (tile.group && tile.type === 'property') {
                const mySet = GameMemory.getGroupCount(tile.group, '__ME__');
                if (mySet.owned === mySet.total - 1) {
                    completesMyMonopoly = true;
                    myCompletedGroup = tile.group;
                    break;
                }
            }
        }

        // FATAL DANGER CHECK: Opponent gets a set, we do NOT!
        if (givesOppMonopoly && !completesMyMonopoly) {
            const counter = this.findCounterTrade(tradeData);
            if (counter) {
                return {
                    accept: false,
                    counterSwap: counter,
                    reason: `FATAL DANGER VETO: Gives ${partnerName} a ${oppGroupName} monopoly while we get none!`,
                    chatReply: CONFIG.CHAT_ENABLED ? `counter me with ${counter.myReceivedTile.name.toLowerCase()}` : null
                };
            }
            return {
                accept: false,
                counterSwap: null,
                reason: `FATAL DANGER VETO: Gives ${partnerName} a ${oppGroupName} monopoly while we get none!`,
                chatReply: CONFIG.CHAT_ENABLED ? `cant give u a set sry` : null
            };
        }

        // MONOPOLY EVALUATION: Securing completed monopolies is the #1 winning condition!
        if (completesMyMonopoly) {
            const myCashAfter = GameMemory.myCash + receivedCash - givenCash;
            if (myCashAfter < 30) {
                // Only decline if the cash terms literally leave us bankrupt
                return {
                    accept: false,
                    counterSwap: this.findCounterTrade(tradeData),
                    reason: `MONOPOLY BLOCKED BY DEBT: Trade completes ${myCompletedGroup} but leaves only $${myCashAfter} cash!`,
                    chatReply: CONFIG.CHAT_ENABLED ? `id be broke lol add cash` : null
                };
            }

            if (givesOppMonopoly) {
                // BOTH PLAYERS GET A SET! Classic Grandmaster Mutual Monopoly Swap!
                return {
                    accept: true,
                    myGain: 3500,
                    oppGain: 3500,
                    reason: `MUTUAL MONOPOLY SWAP: Both players secure completed color sets (${myCompletedGroup})!`,
                    chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
                };
            } else {
                // WE GET A MONOPOLY, OPPONENT GETS NONE! Overwhelming advantage!
                return {
                    accept: true,
                    myGain: 5000,
                    oppGain: 500,
                    reason: `MONOPOLY COMPLETER: Completes our ${myCompletedGroup} monopoly without giving opponent a set!`,
                    chatReply: CONFIG.CHAT_ENABLED ? `deal thx` : null
                };
            }
        }

        // Calculate utility gains
        let myGain = receivedCash - givenCash;
        let oppGain = givenCash - receivedCash;

        for (const tile of receivedTiles) {
            myGain += this.scoreTileForPlayer(tile, '__ME__');
        }
        for (const tile of givenTiles) {
            myGain -= this.scoreTileForPlayer(tile, '__ME__');
            oppGain += this.scoreTileForPlayer(tile, partnerName);
        }

        // 20-Round Forward Rollout Simulation Check
        const sim = this.simulateFutureTradeRounds(tradeData, 20, 80);

        // Simulation Veto: If accepting the trade crashes our 20-round survival rate
        if (sim.accSurvRate < sim.rejSurvRate - 10) {
            return {
                accept: false,
                counterSwap: null,
                reason: `20-ROUND SIMULATION VETO: Accepting drops 20-round survival from ${sim.rejSurvRate}% to ${sim.accSurvRate}%!`,
                chatReply: CONFIG.CHAT_ENABLED ? `nah sry` : null
            };
        }

        // UNFAIR DEFICIT CHECK: Never accept a trade in the opponent's favor!
        if (oppGain > myGain && !completesMyMonopoly) {
            const counter = this.findCounterTrade(tradeData);
            if (counter) {
                return {
                    accept: false,
                    counterSwap: counter,
                    reason: `UNFAIR DEFICIT: Trade favors ${partnerName}. Countering for set completer.`,
                    chatReply: CONFIG.CHAT_ENABLED ? `counter me` : null
                };
            }

            const naturalReplies = [
                "nah sry",
                "cant do that",
                "nty",
                "need more cash with that",
                "counter me with cash",
                "keeping that sry",
                "no thx",
                "pass for now"
            ];
            const chatReply = naturalReplies[Math.floor(Math.random() * naturalReplies.length)];

            return {
                accept: false,
                counterSwap: null,
                reason: `UNFAIR DEFICIT: Trade favors ${partnerName} by +$${Math.round(oppGain - myGain)}.`,
                chatReply: CONFIG.CHAT_ENABLED ? chatReply : null
            };
        }

        const acceptable = myGain > 0 && (myGain >= oppGain * CONFIG.TRADE_MIN_ADVANTAGE_RATIO || completesMyMonopoly) && sim.isSimulationEVPlus;

        GameMemory.lastTradeVerdict = acceptable ? 'ACCEPTABLE' : 'UNFAVORABLE';

        return {
            accept: acceptable,
            myGain: Math.round(myGain),
            oppGain: Math.round(oppGain),
            sim20Rounds: sim,
            counterSwap: acceptable ? null : this.findCounterTrade(tradeData),
            reason: acceptable
                ? `GRANDMASTER EV+ TRADE: Net gain +$${Math.round(myGain)} vs Opp +$${Math.round(oppGain)} (20-turn Sim: +EV)`
                : `Unfavorable utility: Net gain $${Math.round(myGain)} < requirement`,
            chatReply: CONFIG.CHAT_ENABLED ? (acceptable ? "deal thx" : "nah sry") : null
        };
    },

    /**
     * Proactively scans board state for win-win trade opportunities:
     * 1. Mutual Monopoly Swaps (both players complete sets)
     * 2. Monopoly Completing Acquisitions (we offer cash + surplus properties to get our 3rd card!)
     */
    scanMutualMonopolySwaps() {
        const opportunities = [];
        const myMissing = OpponentTracker.getMyMissingCards();
        const opponents = OpponentTracker.analyzeOpponents();
        const safeSacrifices = OpponentTracker.getSafeTradeSacrifices();

        // 1. MUTUAL MONOPOLY SWAPS (Both get sets)
        for (const myNeed of myMissing) {
            if (!myNeed.heldBy || myNeed.isUnowned) continue;

            const targetOppName = myNeed.heldBy;
            const targetOpp = opponents[targetOppName];
            if (!targetOpp) continue;

            for (const oppNeed of targetOpp.hungrySets) {
                if (oppNeed.weHoldIt && oppNeed.missingTile) {
                    const myCardValue = this.scoreTileForPlayer(oppNeed.missingTile, targetOppName);
                    const theirCardValue = this.scoreTileForPlayer(myNeed.missingTile, '__ME__');
                    const cashDiff = myCardValue - theirCardValue;

                    let cashOffer = 0;
                    let cashDemand = 0;
                    if (cashDiff > 0) {
                        cashDemand = Math.min(targetOpp.cash, Math.round(cashDiff * 0.4));
                    } else if (cashDiff < 0) {
                        cashOffer = Math.min(Math.max(0, GameMemory.myCash - 100), Math.round(Math.abs(cashDiff) * 0.4));
                    }

                    opportunities.push({
                        targetOwner: targetOppName,
                        myGivenTile: oppNeed.missingTile,
                        myReceivedTile: myNeed.missingTile,
                        cashOffer: Math.max(0, cashOffer),
                        cashDemand: Math.max(0, cashDemand),
                        summary: `SWAP: Give ${oppNeed.missingTile.name} -> Get ${myNeed.missingTile.name}`,
                        pitch: `swap ${oppNeed.missingTile.name.toLowerCase()} for ${myNeed.missingTile.name.toLowerCase()}?`
                    });
                }
            }
        }

        // 2. MONOPOLY COMPLETER OFFERS (We need 1 card to complete our set!)
        for (const myNeed of myMissing) {
            if (!myNeed.heldBy || myNeed.isUnowned) continue;

            const targetOppName = myNeed.heldBy;
            // Avoid duplicate proposals for the same missing card
            if (opportunities.some(o => o.targetOwner === targetOppName && o.myReceivedTile.id === myNeed.missingTile.id)) continue;

            // Pick our best safe sacrifice property (e.g. Liverpool, New York)
            const sacrificeTile = safeSacrifices.length > 0 ? safeSacrifices[0] : null;

            if (sacrificeTile) {
                // Offer surplus property + cash sweetener
                const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 200), Math.max(50, Math.round(myNeed.missingTile.price * 0.6)));
                opportunities.push({
                    targetOwner: targetOppName,
                    myGivenTile: sacrificeTile,
                    myReceivedTile: myNeed.missingTile,
                    cashOffer: Math.max(0, cashOffer),
                    cashDemand: 0,
                    summary: `MONOPOLY ACQUISITION: Give ${sacrificeTile.name} + $${cashOffer} -> Get ${myNeed.missingTile.name}`,
                    pitch: `take ${sacrificeTile.name.toLowerCase()} + ${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?`
                });
            } else if (GameMemory.myCash >= myNeed.missingTile.price + 150) {
                // Pure cash offer: 1.5x - 2.2x tile face value
                const cashOffer = Math.min(GameMemory.myCash - 100, Math.round(myNeed.missingTile.price * 1.8));
                opportunities.push({
                    targetOwner: targetOppName,
                    myGivenTile: null,
                    myReceivedTile: myNeed.missingTile,
                    cashOffer: Math.max(80, cashOffer),
                    cashDemand: 0,
                    summary: `CASH ACQUISITION: Offer $${cashOffer} -> Get ${myNeed.missingTile.name}`,
                    pitch: `${cashOffer} for ${myNeed.missingTile.name.toLowerCase()}?`
                });
            }
        }

        // 3. SET CONSOLIDATION SWAPS (Advance toward sets by trading singletons)
        const advancingNeeds = OpponentTracker.getMyAdvancingNeeds();
        for (const need of advancingNeeds) {
            const targetOppName = need.heldBy;
            if (opportunities.some(o => o.targetOwner === targetOppName && o.myReceivedTile.id === need.wantedTile.id)) continue;

            const sacrificeTile = safeSacrifices.find(s => s.id !== need.myTile.id) || null;
            if (sacrificeTile) {
                const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 150), Math.max(20, Math.round(need.wantedTile.price * 0.25)));
                const cashLabel = cashOffer > 0 ? ` + $${cashOffer}` : '';
                opportunities.push({
                    targetOwner: targetOppName,
                    myGivenTile: sacrificeTile,
                    myReceivedTile: need.wantedTile,
                    cashOffer: Math.max(0, cashOffer),
                    cashDemand: 0,
                    summary: `SET CONSOLIDATION: Give ${sacrificeTile.name}${cashLabel} -> Get ${need.wantedTile.name}`,
                    pitch: cashOffer > 0 
                        ? `${sacrificeTile.name.toLowerCase()} + ${cashOffer} for ${need.wantedTile.name.toLowerCase()}?`
                        : `swap ${sacrificeTile.name.toLowerCase()} for ${need.wantedTile.name.toLowerCase()}?`
                });
            } else if (GameMemory.myCash >= need.wantedTile.price + 100) {
                const cashOffer = Math.min(GameMemory.myCash - 80, Math.round(need.wantedTile.price * 1.4));
                opportunities.push({
                    targetOwner: targetOppName,
                    myGivenTile: null,
                    myReceivedTile: need.wantedTile,
                    cashOffer: Math.max(70, cashOffer),
                    cashDemand: 0,
                    summary: `CASH ACQUISITION: Offer $${cashOffer} -> Get ${need.wantedTile.name}`,
                    pitch: `${cashOffer} for ${need.wantedTile.name.toLowerCase()}?`
                });
            }
        }

        // 4. AIRPORT ACQUISITION (Airport synergy)
        const myAirports = BOARD_TILES.filter(t => t.type === 'airport' && GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
        if (myAirports.length >= 1 && myAirports.length < 4) {
            const otherAirports = BOARD_TILES.filter(t => t.type === 'airport' && !GameMemory.isMe(GameMemory.ownership[t.id]?.owner));
            for (const air of otherAirports) {
                const holder = GameMemory.ownership[air.id]?.owner;
                if (holder && !opportunities.some(o => o.targetOwner === holder && o.myReceivedTile.id === air.id)) {
                    const cashOffer = Math.min(Math.max(0, GameMemory.myCash - 200), Math.round(air.price * 1.4));
                    if (cashOffer >= 100) {
                        opportunities.push({
                            targetOwner: holder,
                            myGivenTile: null,
                            myReceivedTile: air,
                            cashOffer,
                            cashDemand: 0,
                            summary: `AIRPORT BUYOUT: Offer $${cashOffer} -> Get ${air.name}`,
                            pitch: `${cashOffer} for ${air.name.toLowerCase()}?`
                        });
                    }
                }
            }
        }

        return opportunities;
    }
};
