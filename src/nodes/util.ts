import Ajv from 'ajv';
import { join } from 'path';
import { BehaviorSubject } from 'rxjs';

export function convertValueType(RED, value, type,
    { defaultType = 'bool', defaultValue = false }: { defaultType?: string, defaultValue?: any } = {}) {
    if (type === 'flow' || type === 'global') {
        try {
            const parts = RED.util.normalisePropertyExpression(value);
            if (parts.length === 0) {
                throw new Error();
            }
        } catch (err) {
            value = defaultValue;
            type = defaultType;
        }
    }
    return { value, type };
}

export function getValue(RED, node, value, type) {
    if (type === 'date') {
        return Date.now();
    } else {
        return RED.util.evaluateNodeProperty(value, type, node);
    }
}

export function R(parts: TemplateStringsArray, ...substitutions: any[]) {
    const rounded = substitutions.map(sub => {
        if (typeof sub === 'number') {
            return Math.round(sub * 10) / 10;
        }
        return sub;
    });
    return String.raw(parts, ...rounded);
}

export function updateState<TState, TPayload = Partial<TState>>(
    payload: TPayload,
    state$: BehaviorSubject<TState>,
    mapping?: { from: keyof TPayload, to: keyof TState }[]) {

    if (typeof payload !== 'object') {
        return false;
    }

    const newState = { ...state$.value };
    updateProperties(payload, newState, newState, mapping);
    state$.next(newState);
    return true;
}

function updateProperties(from: any, to: any, rootState: any,
    mapping?: { from: keyof any, to: keyof any }[],
    path = 'msg.payload.') {

    for (const [key, v] of Object.entries(from)) {
        let value: any = v;

        const mapTo = mapping?.find(m => m.from === key)?.to ?? key;

        const prevValue = to[mapTo];
        if (typeof prevValue !== typeof value) {
            if (typeof prevValue === 'number') {
                value = +value;
            }

            if (typeof prevValue === 'boolean') {
                value = !!value;
            }
        }

        if (typeof value === 'object' && typeof prevValue === 'object') {
            updateProperties(v, { ...prevValue }, rootState, mapping, `${path}${key}.`);
        } else {
            to[mapTo] = value;
            if (!validate('state', rootState)) {
                throw new Error(`Invalid property ${path}${key} with value ${value}`);
            }
        }
    }
}

const ajv = new Ajv();
const cachedValidators: { [schemaName: string]: Ajv.ValidateFunction } = {};

function validate(schemaName: string, object: any) {
    let validator = cachedValidators[schemaName];
    if (!validator) {
        const schema = require(join(__dirname, '..', 'schema', schemaName));
        cachedValidators[schemaName] = validator = ajv.compile(schema);
    }

    return validator(object);
}
