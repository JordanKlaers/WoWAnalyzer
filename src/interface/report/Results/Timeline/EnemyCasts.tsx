import Icon from 'interface/Icon';
import SpellLink from 'interface/SpellLink';
import { CastEvent, BeginCastEvent } from 'parser/core/Events';
import {
  Fragment,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import './Casts.scss';
import React from 'react';
import Toggle from 'react-toggle';
import { fetchEvents } from 'common/fetchWclApi';
import { useCombatLogParser } from 'interface/report/CombatLogParserContext';
import TimeIndicators from './TimeIndicators';

interface Props extends HTMLAttributes<HTMLDivElement> {
  start: number;
  windowStart?: number;
  secondWidth: number;
  events: NpcBeginCastEvent[] | NpcCastEvent[];
  reportCode: string;
  actorId: number;
  style?: CSSProperties & {
    '--level'?: number;
  };
}

const RenderIcon = (
  event: NpcCastEvent | NpcBeginCastEvent,
  {
    start,
    windowStart,
    secondWidth,
    className = '',
    style = {},
  }: {
    start: number;
    windowStart?: number | undefined;
    secondWidth: number;
    className?: string;
    style?: CSSProperties & { '--level'?: number };
  } = {
    secondWidth: 60,
    start: 0,
  },
) => {
  const getOffsetLeft = (timestamp: number) =>
    ((timestamp - (windowStart ?? start)) / 1000) * secondWidth;
  const left = getOffsetLeft(event.timestamp);
  const linkIcon = (children: ReactNode) => (
    <SpellLink
      spell={event.ability.guid}
      icon={false}
      className={`cast ${className} ${event.type === 'begincast' && !event.matchedCast ? 'failed-cast upper' : ''}`}
      style={{
        left,
        ...style,
      }}
    >
      {children}
    </SpellLink>
  );
  const spellIcon = (
    <>
      <Icon icon={event.ability.abilityIcon.replace('.jpg', '')} alt={event.ability.name} />
      {!event.matchedCast && event.type === 'begincast' ? (
        <div className={`time-indicator ${className}`}></div>
      ) : (
        <></>
      )}
    </>
  );

  return (
    <Fragment
      // It's possible this complains about "encountered two children with the same key". This is probably caused by fabricating a channel event at a cast time. If you can fix it by removing one of the events that would be great, otherwise you may just have to ignore this as while it's showing a warning, deduplicting the icons is correct behavior.
      key={`cast-${left}-${event.ability.guid}`}
    >
      {linkIcon(spellIcon)}
      {event.matchedCast ? (
        <>
          <div
            className={`channel ${className}`}
            style={{
              left,
              width: ((event.matchedCast.timestamp - event.timestamp) / 1000) * secondWidth,
            }}
          />
        </>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

const RenderCast = React.memo(
  ({
    event,
    className,
    start,
    windowStart,
    secondWidth,
  }: {
    event: NpcCastEvent | NpcBeginCastEvent;
    className: string;
  } & Pick<Props, 'start' | 'windowStart' | 'secondWidth'>) => {
    return RenderIcon(event, {
      className,
      start,
      windowStart,
      secondWidth,
    });
  },
);

const EnemyCasts = React.memo(
  ({ start, windowStart, secondWidth, events, reportCode, actorId, ...others }: Props) => {
    const style: CSSProperties & { '--levels'?: number } = {
      '--levels': 0,
      ...others.style,
    };
    return (
      <div className="casts" {...others} style={{ ...style, position: 'relative' }}>
        {events.map((castEvent: NpcCastEvent | NpcBeginCastEvent, index: number) => {
          let className = '';
          if (castEvent.npc?.subType === 'Boss') {
            className = 'npc-boss-cast';
          } else if (castEvent.matchedCast) {
            className = 'npc-channeled-cast';
          } else if (!castEvent.matchedCast && castEvent.type === 'begincast') {
            className = 'npc-stopped-cast';
          } else if (!castEvent.matchedCast) {
            className = 'npc-instant-cast';
          }

          return (
            <RenderCast
              key={`npc_cast_${index}`}
              event={castEvent}
              className={className}
              start={start}
              windowStart={windowStart}
              secondWidth={secondWidth}
            />
          );
        })}
      </div>
    );
  },
);

export default EnemyCasts;

const EnemySpellTypeToggle = ({
  label,
  toggleCallBack,
  checked,
}: {
  label: string;
  toggleCallBack: () => void;
  checked: boolean;
}) => {
  return (
    <div className="npc-toggle-container">
      <span className="text-left toggle-control npc-toggle-options">
        <Toggle
          defaultChecked={checked}
          icons={false}
          onChange={toggleCallBack}
          id="absolute-toggle"
        />
        <label htmlFor="absolute-toggle" style={{ marginRight: 'auto' }}>
          {label}
        </label>
      </span>
    </div>
  );
};

export const EnemyCastsTimeline = ({
  seconds,
  start,
  secondWidth,
  offset,
  skipInterval,
}: TimelineProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { combatLogParser: parser } = useCombatLogParser();
  const [shouldRenderNPCSpells, setRenderNPCSpells] = useState<boolean>(false);
  const [NPCCasts, setNPCCasts] = useState<(BeginCastEvent | CastEvent | any)[]>([]);

  const [instantCast, setInstantCast] = useState(true);
  const [channeledAbilities, setChanneledAbilities] = useState(true);
  const [interruptedAbilities, setInterruptedAbilities] = useState(true);
  const [bossAbilities, setBossAbilities] = useState(true);

  const [hasUserRequestedNPCSpells, setHasUserRequestedNPCSpells] = useState<boolean>(false);
  const [loadingNPCSpellsState, setLoadingNPCSpellsState] = useState<
    'notFetched' | 'loading' | 'loaded'
  >('notFetched');

  const toggleHandler = useCallback(() => {
    setRenderNPCSpells((prev) => {
      //set hasUserRequestsNPCSpells to true when the toggle goes from false to true, indicating the user wants to see the npc spells for the first  time
      if (!prev) {
        setHasUserRequestedNPCSpells(true);
        setLoadingNPCSpellsState((current) => (current === 'notFetched' ? 'loading' : current));
      }
      return !prev;
    });
  }, []);

  const toggle = useCallback((key: string, active: boolean) => {
    const div = containerRef.current;
    if (!div) {
      return;
    }

    div.style.setProperty(`--npc-${key}`, active ? 'block' : 'none');
  }, []);

  useEffect(() => {
    toggle('content', shouldRenderNPCSpells);
  }, [shouldRenderNPCSpells, toggle]);

  useEffect(() => {
    const fetchData = async () => {
      if (hasUserRequestedNPCSpells) {
        try {
          //This call grabs the abilities cast by NPCs
          const events = (await fetchEvents(
            parser.report.code,
            parser.fight.start_time,
            parser.fight.end_time,
            undefined,
            "type in ('begincast', 'cast') and source.type in ('NPC', 'Boss') AND ability.id > 1 AND sourceID > -1",
            40,
          )) as (NpcBeginCastEvent | NpcCastEvent)[];
          //This call grabs the damage events that friendly players took from NPCs
          const damageStuff = (await fetchEvents(
            parser.report.code,
            parser.fight.start_time,
            parser.fight.end_time,
            undefined,
            "type = 'damage' AND source.type in ('NPC', 'Boss') AND ability.id > 1 AND source.id > 0 AND target.type = 'Player'",
            40,
          )) as any;
          //These three reducers map the character id to the character so that the source and targets for the damage events can be matched
          const enemies = parser.report.enemies.reduce(
            (acc: Record<number, any>, cur: { id: number }) => {
              if (!acc[cur.id]) {
                acc[cur.id] = cur;
              }
              return acc;
            },
            {},
          );
          const enemyPets = parser.report.enemyPets.reduce(
            (acc: Record<number, any>, cur: { id: number }) => {
              if (!acc[cur.id]) {
                acc[cur.id] = cur;
              }
              return acc;
            },
            {},
          );
          const allies = parser.combatantInfoEvents.reduce(
            (acc: Record<number, any>, cur: { sourceID: number; player: any }) => {
              if (!acc[cur.sourceID]) {
                acc[cur.sourceID] = cur.player;
              }
              return acc;
            },
            {},
          );

          //This groups damage events together. Helpful for aoe spells from the enemy that hit multiple players at the same time
          const nonMeleeDamageEvents = damageStuff.reduce((acc: any, cur: any) => {
            const lastItem = acc[acc.length - 1];
            if (cur.sourceID > -1) {
              if (
                Array.isArray(lastItem) &&
                //group events that are within 300ms and have the same ability name and source
                lastItem[lastItem.length - 1].timestamp <= cur.timestamp &&
                lastItem[lastItem.length - 1].timestamp >= cur.timestamp - 300 &&
                lastItem[lastItem.length - 1].sourceID === cur.sourceID &&
                lastItem[lastItem.length - 1].ability.name === cur.ability.name
              ) {
                lastItem.push(cur);
              } else if (
                lastItem &&
                lastItem.timestamp <= cur.timestamp &&
                lastItem.timestamp >= cur.timestamp - 300 &&
                lastItem.sourceID === cur.sourceID &&
                lastItem.ability.name === cur.ability.name
              ) {
                acc[acc.length - 1] = [lastItem, cur];
              } else {
                acc.push(cur);
              }
            }
            return acc;
          }, []) as any;

          const beginCastMap: { [key: string]: NpcCastEvent | NpcBeginCastEvent } = {};
          /*
            This loop maps the npc to the event as well as the friendly player, if it was a targeted spell.
            It also combines cast events with their matching begin cast event. This is helpful to find which casts were interrupted. (begincast events without a matching cast)
          */
          for (let i = 0; i < events.length; i = i + 1) {
            const event = events[i] as NpcCastEvent | NpcBeginCastEvent;
            event['npc'] = enemies[event.sourceID];
            event['npcPet'] = enemyPets[event.sourceID];
            const eventKey = `${event.ability.name}_${event.sourceID}`;
            if (allies[event.targetID]) {
              event['friendlyTarget'] = allies[event.targetID];
            }
            if (event.type === 'begincast') {
              beginCastMap[eventKey] = event;
            } else if (event.type === 'cast') {
              const beginCast = beginCastMap[eventKey];
              if (beginCast) {
                beginCast.matchedCast = event;
                events.splice(i, 1);
                i = i - 1;
              }
            }
          }

          /*
            This loop combines the damage events on players with the cast event from the npc.
            It assums the damage is dealt within 10 seconds from the cast.
            It also removes npc abilities that were melee, or did not damage an ally
          */
          const npcAbilities = events.filter((event) => {
            const matchingDmgEvent = nonMeleeDamageEvents.filter((damageTaken: any) => {
              const dmgEvent = Array.isArray(damageTaken) ? damageTaken[0] : damageTaken;
              return (
                dmgEvent.timestamp >= event.timestamp &&
                dmgEvent.timestamp <= event.timestamp + 10000 && //Assumes a damage event from an npc ability happens within 10 seconds
                dmgEvent.sourceID === event.sourceID &&
                dmgEvent.ability.name === event.ability.name
              );
            });
            event['matchingDmgEvent'] = matchingDmgEvent;
            return (
              //remove events that do not damage allies.
              //keep events that were silenced/interrupted/stopped
              matchingDmgEvent.length || (!event.matchedCast && event.type === 'begincast')
            );
          });
          setNPCCasts(npcAbilities);
          setLoadingNPCSpellsState('loaded');
        } catch (err) {
          console.log('failed npc cast call: ', err);
        }
      }
    };

    fetchData();
  }, [
    parser.report.code,
    parser.fight.start_time,
    parser.fight.end_time,
    parser.combatantInfoEvents,
    parser.report.enemies,
    parser.report.enemyPets,
    hasUserRequestedNPCSpells,
  ]);

  return (
    <div ref={containerRef}>
      <EnemySpellTypeToggle
        label="Render NPC Spells on the timeline"
        toggleCallBack={() => {
          toggleHandler();
        }}
        checked={shouldRenderNPCSpells}
      />
      {loadingNPCSpellsState === 'loading' ? (
        <div>Loading</div>
      ) : loadingNPCSpellsState === 'loaded' ? (
        <div className="npc-content-container">
          <EnemySpellTypeToggle
            label="Instant Cast Abilities"
            toggleCallBack={() => {
              setInstantCast((v) => {
                toggle('instant-cast', !v);
                return !v;
              });
            }}
            checked={instantCast}
          />
          <EnemySpellTypeToggle
            label="channeled Abilities"
            toggleCallBack={() => {
              setChanneledAbilities((v) => {
                toggle('channeled-cast', !v);
                return !v;
              });
            }}
            checked={channeledAbilities}
          />
          <EnemySpellTypeToggle
            label="Silenced/Interrupted Abilities"
            toggleCallBack={() => {
              setInterruptedAbilities((v) => {
                toggle('stopped-cast', !v);
                return !v;
              });
            }}
            checked={interruptedAbilities}
          />
          <EnemySpellTypeToggle
            label="Boss Abilities"
            toggleCallBack={() => {
              setBossAbilities((v) => {
                toggle('boss-cast', !v);
                return !v;
              });
            }}
            checked={bossAbilities}
          />
          <TimeIndicators
            seconds={seconds}
            offset={offset}
            secondWidth={secondWidth}
            skipInterval={skipInterval}
          />
          <EnemyCasts
            start={start}
            secondWidth={secondWidth}
            reportCode={parser.report.code}
            actorId={parser.player.id}
            events={NPCCasts}
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

interface TimelineProps {
  seconds: number;
  start: number;
  secondWidth: number;
  offset: number;
  skipInterval: number;
}

interface NpcInfo {
  fights: Array<{
    id: number;
    name: string;
  }>;
  guid: number;
  icon: string;
  id: number;
  name: string;
  petOwner: string | null;
  subType: string;
  type: string;
}
interface NpcCastEvent extends CastEvent {
  npc: NpcInfo;
  npcPet: NpcInfo;
  matchedCast?: any;
  friendlyTarget?: any;
  targetID: number;
  time: string;
  matchingDmgEvent?: any;
}
interface NpcBeginCastEvent extends BeginCastEvent {
  npc: NpcInfo;
  npcPet: NpcInfo;
  matchedCast?: any;
  friendlyTarget?: any;
  targetID: number;
  time: string;
  matchingDmgEvent?: any;
}
